import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { describeError } from '../common/errors/error-message';
import { UploadService, sniffVideoContentType } from '../upload/upload.service';
import type { PostMediaKind } from './entities/post-media.entity';
import {
  Post,
  type PostAuthorRole,
  type PostStatus,
} from './entities/post.entity';
import {
  MAX_CAPTION,
  MAX_MEDIAS,
  MAX_VIDEO_SEGUNDOS,
  MAX_VIDEOS,
  puedeTransicionar,
  siguienteAlEditar,
} from './post-estados';

export const DEFAULT_POSTS_PAGE = 20;
export const MAX_POSTS_PAGE = 50;

/** Quien escribe el post y en nombre de que modelo. */
export type AutorDelPost = {
  employeeId: string;
  authorUserId: string;
  authorRole: PostAuthorRole;
};

/** Una foto o video nuevo. El tipo lo deciden los bytes, no quien llama. */
export type NuevaMedia = {
  buffer: Buffer;
  // Fotograma del video, generado en el navegador; obligatorio para video.
  posterBuffer?: Buffer;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type MediaDelPost = {
  id: string;
  kind: PostMediaKind;
  url: string;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  position: number;
};

/** Un post tal como lo ve quien lo gestiona (la modelo o su jefe). */
export type PostDeLaModelo = {
  id: string;
  caption: string;
  status: PostStatus;
  rejectionReason: string | null;
  submittedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  likeCount: number;
  media: MediaDelPost[];
};

export type PaginaDePosts = {
  items: PostDeLaModelo[];
  nextCursor: string | null;
};

export type ResultadoDeBorrar = {
  id: string;
  resultado: 'borrado' | 'archivado';
};

type EstadoDelPost = {
  status: PostStatus;
  medias: number;
  videos: number;
};

type Ejecutor = Pick<EntityManager, 'query'>;

/*
 * `enviar` acepta un rechazado aunque la maquina de estados no tenga
 * `rechazado -> pendiente`: lo hace como `rechazado -> borrador -> pendiente`,
 * dos pasos permitidos en un solo UPDATE, igual que el jefe encadena
 * `borrador -> pendiente -> aprobado`. Asi la modelo puede reenviarlo sin
 * tener que tocar algo para que pase por borrador.
 */
const ORIGENES_DE_ENVIO: readonly PostStatus[] = ['borrador', 'rechazado'];

// Lo que nunca llego a publicarse se borra de verdad, con su media en R2.
const SE_BORRAN_DE_VERDAD: readonly PostStatus[] = ['borrador', 'rechazado'];

const UNIQUE_DE_POSICION = 'uq_post_media_post_position';

/**
 * Operaciones de dominio sobre los posts de una modelo.
 *
 * No conoce al actor: la modelo y el jefe (B5) llaman a los mismos metodos y
 * cada uno decide antes si le toca esa modelo. Lo unico que este servicio
 * garantiza es que el post pertenece a la `employeeId` que se le pasa, que es
 * obligatoria en todas las operaciones sobre un post: un post ajeno responde
 * igual que uno inexistente (404), para no confirmar que existe.
 *
 * Toda transicion es un `UPDATE ... WHERE status = <leido>` comprobado por las
 * filas devueltas, de modo que dos peticiones simultaneas no pueden aplicar
 * ambas su cambio: la que pierde recibe 409. Las operaciones sobre la media
 * ademas bloquean la fila del post (`FOR UPDATE`) para que los topes y las
 * posiciones se calculen sin que otra subida los cambie por debajo.
 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly uploadService: UploadService,
  ) {}

  async crearBorrador(
    input: AutorDelPost & { caption: string },
  ): Promise<PostDeLaModelo> {
    const caption = normalizarCaption(input.caption);
    const post = await this.posts.save(
      this.posts.create({
        employeeId: input.employeeId,
        authorUserId: input.authorUserId,
        authorRole: input.authorRole,
        caption,
        status: 'borrador',
      }),
    );
    return this.obtener(post.id, input.employeeId);
  }

  /**
   * Cambia el texto. Editar un aprobado lo devuelve a revision (y lo saca del
   * feed) conservando likes y `published_at`: si se vuelve a aprobar, el jefe
   * (B5) debe conservar esa fecha (`COALESCE(published_at, now())`) para que
   * editar no sirva para subir un post viejo al principio del feed. Editar un
   * rechazado lo devuelve a borrador y deja el motivo a la vista hasta que se
   * reenvie.
   */
  async editarCaption(
    postId: string,
    employeeId: string,
    caption: string,
  ): Promise<PostDeLaModelo> {
    const texto = normalizarCaption(caption);
    await this.dataSource.transaction(async (manager) => {
      const estado = await this.leerEstado(manager, postId, employeeId, true);
      await this.aplicarEdicion(manager, postId, estado, estado.medias, texto);
    });
    return this.obtener(postId, employeeId);
  }

  /**
   * Agrega una foto o un video al final del post.
   *
   * Los topes se comprueban dos veces: antes de subir, para no mandar a R2 lo
   * que se va a rechazar, y con el post bloqueado, porque entre medias otra
   * subida pudo llenar el cupo. Si algo falla despues de subir, lo subido se
   * borra de R2: la fila nunca existio y nadie mas lo referencia.
   */
  async agregarMedia(
    postId: string,
    employeeId: string,
    media: NuevaMedia,
  ): Promise<PostDeLaModelo> {
    const kind: PostMediaKind =
      media.buffer?.length && sniffVideoContentType(media.buffer)
        ? 'video'
        : 'imagen';
    validarMedia(kind, media);

    const previo = await this.leerEstado(
      this.dataSource,
      postId,
      employeeId,
      false,
    );
    validarCupo(previo, kind);

    const subida = await this.uploadService.uploadPostMedia({
      buffer: media.buffer,
      employeeId,
      kind,
    });
    let posterUrl: string | null = null;
    try {
      if (kind === 'video') {
        const poster = await this.uploadService.uploadPostPoster({
          buffer: media.posterBuffer as Buffer,
          employeeId,
        });
        posterUrl = poster.url;
      }

      await this.dataSource.transaction(async (manager) => {
        const estado = await this.leerEstado(manager, postId, employeeId, true);
        validarCupo(estado, kind);
        // Las posiciones van compactas desde 0, asi que la siguiente es el
        // numero de medias que ya hay.
        await manager.query(
          `INSERT INTO post_media
             (post_id, kind, url, poster_url, mime_type, bytes, width, height,
              duration_ms, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            postId,
            kind,
            subida.url,
            posterUrl,
            subida.mimeType,
            subida.bytes,
            media.width ?? null,
            media.height ?? null,
            kind === 'video' ? (media.durationMs ?? null) : null,
            estado.medias,
          ],
        );
        await this.aplicarEdicion(manager, postId, estado, estado.medias + 1);
      });
    } catch (error) {
      await this.descartarArchivos([subida.url, posterUrl]);
      throw error;
    }
    return this.obtener(postId, employeeId);
  }

  /** Quita una media y cierra el hueco en las posiciones. */
  async quitarMedia(
    postId: string,
    employeeId: string,
    mediaId: string,
  ): Promise<PostDeLaModelo> {
    const archivos = await this.dataSource.transaction(async (manager) => {
      const estado = await this.leerEstado(manager, postId, employeeId, true);
      exigirEditable(estado.status);

      const borradas: Array<{
        url: string;
        poster_url: string | null;
        position: number;
      }> = await manager.query(
        `WITH borrada AS (
           DELETE FROM post_media WHERE id = $1 AND post_id = $2
           RETURNING url, poster_url, position
         )
         SELECT url, poster_url, position FROM borrada`,
        [mediaId, postId],
      );
      const borrada = borradas[0];
      if (!borrada) throw new NotFoundException('Media no encontrada');

      await manager.query(
        `UPDATE post_media SET position = position - 1
          WHERE post_id = $1 AND position > $2`,
        [postId, borrada.position],
      );
      // Un post en revision sin media no se puede revisar: aplicarEdicion lo
      // rechaza y la transaccion devuelve la media a su sitio.
      await this.aplicarEdicion(manager, postId, estado, estado.medias - 1);
      return [borrada.url, borrada.poster_url];
    });
    // Despues del commit: si R2 falla, la fila ya no existe y solo queda un
    // archivo huerfano, que no debe tumbar la peticion.
    await this.descartarArchivos(archivos);
    return this.obtener(postId, employeeId);
  }

  /**
   * Fija el orden completo de la media. `ids` debe traer todas las medias del
   * post, cada una una vez.
   *
   * Se reescribe en un solo UPDATE dentro de la transaccion. El UNIQUE de
   * `(post_id, position)` es diferido, asi que los intercambios no chocan
   * hasta el commit, cuando ya son coherentes; el `SET CONSTRAINTS` lo deja
   * dicho por si la restriccion cambiara a `INITIALLY IMMEDIATE`.
   */
  async reordenarMedia(
    postId: string,
    employeeId: string,
    ids: string[],
  ): Promise<PostDeLaModelo> {
    const pedidos = ids.map((id) => id.toLowerCase());
    if (new Set(pedidos).size !== pedidos.length) {
      throw new BadRequestException('La lista trae medias repetidas');
    }

    await this.dataSource.transaction(async (manager) => {
      const estado = await this.leerEstado(manager, postId, employeeId, true);
      exigirEditable(estado.status);

      const actuales: Array<{ id: string }> = await manager.query(
        `SELECT id FROM post_media WHERE post_id = $1 ORDER BY position`,
        [postId],
      );
      const conocidos = new Set(actuales.map((fila) => fila.id));
      if (
        actuales.length !== pedidos.length ||
        pedidos.some((id) => !conocidos.has(id))
      ) {
        throw new BadRequestException(
          'La lista debe traer todas las medias del post, en su nuevo orden',
        );
      }
      // Mismo orden: no es una edicion y no debe sacar del feed un aprobado.
      if (actuales.every((fila, indice) => fila.id === pedidos[indice])) {
        return;
      }

      await manager.query(`SET CONSTRAINTS ${UNIQUE_DE_POSICION} DEFERRED`);
      await manager.query(
        `UPDATE post_media m
            SET position = orden.posicion - 1
           FROM unnest($2::uuid[]) WITH ORDINALITY AS orden(id, posicion)
          WHERE m.id = orden.id AND m.post_id = $1`,
        [postId, pedidos],
      );
      await this.aplicarEdicion(manager, postId, estado, estado.medias);
    });
    return this.obtener(postId, employeeId);
  }

  /**
   * Manda el post a revision. Un solo UPDATE condicionado al estado y a que
   * tenga media; si no aplica, se averigua por que para responder con el
   * codigo correcto. Limpia el motivo del rechazo anterior: ya no aplica a lo
   * que se envia.
   */
  async enviar(postId: string, employeeId: string): Promise<PostDeLaModelo> {
    const enviados: Array<{ id: string }> = await this.dataSource.query(
      `WITH enviado AS (
         UPDATE posts p
            SET status = 'pendiente',
                submitted_at = now(),
                rejection_reason = NULL,
                updated_at = now()
          WHERE p.id = $1
            AND p.employee_id = $2
            AND p.status::text = ANY($3::text[])
            AND EXISTS (SELECT 1 FROM post_media m WHERE m.post_id = p.id)
         RETURNING p.id
       )
       SELECT id FROM enviado`,
      [postId, employeeId, ORIGENES_DE_ENVIO],
    );
    if (!enviados[0]) {
      const estado = await this.leerEstado(
        this.dataSource,
        postId,
        employeeId,
        false,
      );
      if (!ORIGENES_DE_ENVIO.includes(estado.status)) {
        throw new ConflictException(
          estado.status === 'pendiente'
            ? 'El post ya está en revisión'
            : 'Solo se puede enviar un borrador o un post rechazado',
        );
      }
      if (!puedeTransicionar('borrador', 'pendiente', estado)) {
        throw sinMedia();
      }
      // Estado y media correctos ahora, pero no cuando se intento: otra
      // peticion lo cambio entre medias.
      throw cambioConcurrente();
    }
    return this.obtener(postId, employeeId);
  }

  /**
   * El "borrar" de la modelo. Lo que nunca se publico (borrador, rechazado)
   * se borra de verdad con su media; lo que esta en revision o publicado se
   * archiva, porque puede tener likes y un rastro que conservar. Borrar un
   * archivado no hace nada: un reintento no debe fallar.
   */
  async borrar(postId: string, employeeId: string): Promise<ResultadoDeBorrar> {
    const { resultado, archivos } = await this.dataSource.transaction(
      async (manager) => {
        const estado = await this.leerEstado(manager, postId, employeeId, true);
        if (estado.status === 'archivado') {
          return { resultado: 'archivado' as const, archivos: [] };
        }

        if (SE_BORRAN_DE_VERDAD.includes(estado.status)) {
          const medias: Array<{ url: string; poster_url: string | null }> =
            await manager.query(
              `SELECT url, poster_url FROM post_media WHERE post_id = $1`,
              [postId],
            );
          // La media y los likes caen por cascada.
          const borrados: Array<{ id: string }> = await manager.query(
            `WITH borrado AS (
               DELETE FROM posts WHERE id = $1 AND status = $2 RETURNING id
             )
             SELECT id FROM borrado`,
            [postId, estado.status],
          );
          if (!borrados[0]) throw cambioConcurrente();
          return {
            resultado: 'borrado' as const,
            archivos: medias.flatMap((m) => [m.url, m.poster_url]),
          };
        }

        if (!puedeTransicionar(estado.status, 'archivado')) {
          throw cambioConcurrente();
        }
        const archivados: Array<{ id: string }> = await manager.query(
          `WITH archivado AS (
             UPDATE posts
                SET status = 'archivado', archived_at = now(), updated_at = now()
              WHERE id = $1 AND status = $2
             RETURNING id
           )
           SELECT id FROM archivado`,
          [postId, estado.status],
        );
        if (!archivados[0]) throw cambioConcurrente();
        return { resultado: 'archivado' as const, archivos: [] };
      },
    );
    await this.descartarArchivos(archivos);
    return { id: postId, resultado };
  }

  /**
   * Posts de una modelo, del mas reciente al mas antiguo, sin los archivados
   * (para ella "borrar" los quita de la vista). El cursor es el id del ultimo
   * post de la pagina anterior; se pagina por `(created_at, id)`.
   */
  async listarDeLaModelo(
    employeeId: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<PaginaDePosts> {
    const limit = Math.min(query.limit ?? DEFAULT_POSTS_PAGE, MAX_POSTS_PAGE);
    // Uno de mas para saber si hay otra pagina sin un COUNT aparte.
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT p.id
         FROM posts p
        WHERE p.employee_id = $1
          AND p.status <> 'archivado'
          AND ($2::uuid IS NULL OR (p.created_at, p.id) < (
                SELECT c.created_at, c.id FROM posts c
                 WHERE c.id = $2::uuid AND c.employee_id = $1))
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $3`,
      [employeeId, query.cursor ?? null, limit + 1],
    );
    const hayMas = filas.length > limit;
    const ids = (hayMas ? filas.slice(0, limit) : filas).map((f) => f.id);
    if (!ids.length) return { items: [], nextCursor: null };

    const posts = await this.posts.find({
      where: { id: In(ids), employeeId },
      relations: { media: true },
    });
    const porId = new Map(posts.map((post) => [post.id, post]));
    const items = ids
      .map((id) => porId.get(id))
      .filter((post): post is Post => post !== undefined)
      .map(aPostDeLaModelo);
    return { items, nextCursor: hayMas ? ids[ids.length - 1] : null };
  }

  /** Un post con su media, solo si es de esa modelo. */
  async obtener(postId: string, employeeId: string): Promise<PostDeLaModelo> {
    const post = await this.posts.findOne({
      where: { id: postId, employeeId },
      relations: { media: true },
    });
    if (!post) throw postNoEncontrado();
    return aPostDeLaModelo(post);
  }

  /**
   * Modelo a la que pertenece un post. Para quien no parte de la modelo (el
   * jefe en B5): primero resuelve de quien es, decide si le toca y despues
   * llama a las operaciones con esa `employeeId`.
   */
  async modeloDelPost(postId: string): Promise<string> {
    const post = await this.posts.findOne({
      where: { id: postId },
      select: { id: true, employeeId: true },
    });
    if (!post) throw postNoEncontrado();
    return post.employeeId;
  }

  /**
   * Estado del post y cuantas medias y videos tiene. Con `bloquear`, la fila
   * del post queda tomada hasta el final de la transaccion. Van en dos
   * consultas porque `FOR UPDATE` no admite agregados.
   */
  private async leerEstado(
    ejecutor: Ejecutor,
    postId: string,
    employeeId: string,
    bloquear: boolean,
  ): Promise<EstadoDelPost> {
    const posts: Array<{ status: PostStatus }> = await ejecutor.query(
      `SELECT status FROM posts WHERE id = $1 AND employee_id = $2${
        bloquear ? ' FOR UPDATE' : ''
      }`,
      [postId, employeeId],
    );
    if (!posts[0]) throw postNoEncontrado();
    const conteos: Array<{ medias: number; videos: number }> =
      await ejecutor.query(
        `SELECT count(*)::int AS medias,
                count(*) FILTER (WHERE kind = 'video')::int AS videos
           FROM post_media WHERE post_id = $1`,
        [postId],
      );
    return {
      status: posts[0].status,
      medias: Number(conteos[0]?.medias ?? 0),
      videos: Number(conteos[0]?.videos ?? 0),
    };
  }

  /**
   * Aplica la regla de "editar" (`siguienteAlEditar`) despues de un cambio de
   * texto o de media: un aprobado vuelve a revision con `submitted_at` nuevo
   * para entrar a la cola por el final, un rechazado vuelve a borrador.
   */
  private async aplicarEdicion(
    manager: Ejecutor,
    postId: string,
    estado: EstadoDelPost,
    mediasDespues: number,
    caption?: string,
  ): Promise<void> {
    const siguiente = exigirEditable(estado.status);
    if (siguiente === 'pendiente' && mediasDespues < 1) throw sinMedia();
    if (
      siguiente !== estado.status &&
      !puedeTransicionar(estado.status, siguiente, { medias: mediasDespues })
    ) {
      throw cambioConcurrente();
    }

    const vuelveARevision =
      siguiente === 'pendiente' && estado.status !== 'pendiente';
    const editados: Array<{ id: string }> = await manager.query(
      `WITH editado AS (
         UPDATE posts
            SET status = $3,
                caption = COALESCE($4::text, caption),
                submitted_at = CASE WHEN $5::boolean THEN now()
                                    ELSE submitted_at END,
                updated_at = now()
          WHERE id = $1 AND status = $2
         RETURNING id
       )
       SELECT id FROM editado`,
      [postId, estado.status, siguiente, caption ?? null, vuelveARevision],
    );
    if (!editados[0]) throw cambioConcurrente();
  }

  private async descartarArchivos(
    urls: Array<string | null | undefined>,
  ): Promise<void> {
    await Promise.all(
      urls
        .filter((url): url is string => Boolean(url))
        .map(async (url) => {
          try {
            await this.uploadService.deleteFile(url);
          } catch (error) {
            // Un archivo huerfano en R2 no debe tumbar la operacion.
            this.logger.warn(
              `No se pudo borrar el archivo de R2 ${url}: ${describeError(error)}`,
            );
          }
        }),
    );
  }
}

function aPostDeLaModelo(post: Post): PostDeLaModelo {
  return {
    id: post.id,
    caption: post.caption,
    status: post.status,
    rejectionReason: post.rejectionReason,
    submittedAt: post.submittedAt,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    likeCount: post.likeCount,
    media: [...(post.media ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((media) => ({
        id: media.id,
        kind: media.kind,
        url: media.url,
        posterUrl: media.posterUrl,
        width: media.width,
        height: media.height,
        durationMs: media.durationMs,
        position: media.position,
      })),
  };
}

function normalizarCaption(caption: string): string {
  const texto = (caption ?? '').trim();
  if (texto.length > MAX_CAPTION) {
    throw new BadRequestException(
      `El texto no puede superar ${MAX_CAPTION} caracteres`,
    );
  }
  return texto;
}

/** Devuelve el estado tras editar o lanza 409 si el post ya no se edita. */
function exigirEditable(estado: PostStatus): PostStatus {
  const siguiente = siguienteAlEditar(estado);
  if (!siguiente) {
    throw new ConflictException('Un post archivado no se puede editar');
  }
  return siguiente;
}

function validarMedia(kind: PostMediaKind, media: NuevaMedia): void {
  if (kind === 'video') {
    if (!media.posterBuffer?.length) {
      throw new BadRequestException('Un video necesita su imagen de portada');
    }
    // La duracion la declara el navegador y no se verifica (ver
    // `PostMedia.durationMs`); el tope real es el de bytes.
    if (
      media.durationMs !== undefined &&
      media.durationMs > MAX_VIDEO_SEGUNDOS * 1000
    ) {
      throw new BadRequestException(
        `El video no puede durar más de ${MAX_VIDEO_SEGUNDOS} segundos`,
      );
    }
    return;
  }
  if (media.posterBuffer?.length) {
    throw new BadRequestException('Solo un video lleva imagen de portada');
  }
}

function validarCupo(estado: EstadoDelPost, kind: PostMediaKind): void {
  exigirEditable(estado.status);
  if (estado.medias >= MAX_MEDIAS) {
    throw new BadRequestException(
      `Un post admite como máximo ${MAX_MEDIAS} fotos o videos`,
    );
  }
  if (kind === 'video' && estado.videos >= MAX_VIDEOS) {
    throw new BadRequestException(
      `Un post admite como máximo ${MAX_VIDEOS} videos`,
    );
  }
}

function postNoEncontrado(): NotFoundException {
  return new NotFoundException('Post no encontrado');
}

function sinMedia(): BadRequestException {
  return new BadRequestException(
    'El post necesita al menos una foto o un video para ir a revisión',
  );
}

function cambioConcurrente(): ConflictException {
  return new ConflictException(
    'El post cambió mientras se guardaba; vuelve a cargarlo e inténtalo de nuevo',
  );
}
