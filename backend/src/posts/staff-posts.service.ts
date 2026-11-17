import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { describeError } from '../common/errors/error-message';
import {
  modeloAlAlcance,
  modelosAlAlcance,
  type ActorDelEquipo,
} from '../conversations/alcance-del-jefe';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import type { ListStaffPostsDto } from './dto/staff-posts.dto';
import type { PostAuthorRole, PostStatus } from './entities/post.entity';
import { puedeTransicionar } from './post-estados';
import {
  DEFAULT_POSTS_PAGE,
  MAX_POSTS_PAGE,
  PostsService,
  type MediaDelPost,
  type NuevaMedia,
  type ResultadoDeBorrar,
} from './posts.service';

/** Un post tal como lo ve el equipo en la cola y en el detalle. */
export type PostDelEquipo = {
  id: string;
  caption: string;
  status: PostStatus;
  rejectionReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  likeCount: number;
  authorRole: PostAuthorRole;
  employee: {
    id: string;
    nombreArtistico: string;
    fotoPerfilUrl: string | null;
  };
  media: MediaDelPost[];
};

export type PaginaDelEquipo = {
  items: PostDelEquipo[];
  nextCursor: string | null;
};

type FilaPost = {
  id: string;
  caption: string;
  status: PostStatus;
  rejection_reason: string | null;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  published_at: Date | null;
  created_at: Date;
  like_count: number;
  author_role: PostAuthorRole;
  cursor_at: string | null;
  employee_id: string;
  nombre_artistico: string;
  foto_perfil_url: string | null;
  media: MediaDelPost[] | null;
};

type Cursor = { fecha: string; id: string };

type Ejecutor = Pick<EntityManager, 'query'>;

const POST_NO_ENCONTRADO = 'Post no encontrado';
const MODELO_NO_ENCONTRADA = 'Modelo no encontrada';

// Fecha con microsegundos y en UTC, tal como la produce `cursor_at`.
const FECHA_DEL_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lo que un jefe o admin puede publicar de una vez: lo que la modelo podria
// enviar a revision (ver `ORIGENES_DE_ENVIO` en `PostsService`).
const ORIGENES_DE_PUBLICACION: readonly PostStatus[] = [
  'borrador',
  'rechazado',
];
const AUTORES_DEL_EQUIPO: readonly PostAuthorRole[] = ['jefe', 'admin'];

/**
 * Posts vistos por el equipo (jefes y admins): la cola de revision, aprobar,
 * rechazar y archivar, y publicar en nombre de una modelo.
 *
 * El alcance se resuelve aqui, como en el chat web: el admin ve todo y un jefe
 * solo las modelos que le tocan (`alcance-del-jefe.ts`). Siempre se mira la
 * modelo del post, sea cual sea su estado; fuera de alcance responde 404,
 * igual que un post inexistente, para no revelar que existe.
 *
 * Aprobar y rechazar son UPDATE condicionados a `pendiente`: de dos jefes que
 * deciden a la vez gana uno y el otro recibe 409.
 */
@Injectable()
export class StaffPostsService {
  private readonly logger = new Logger(StaffPostsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Empleadas)
    private readonly empleadas: Repository<Empleadas>,
    private readonly postsService: PostsService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  // ---------------------------------------------------------------- lectura

  /**
   * Cola de revision (por defecto) o lista por estado. `pendiente` va por
   * `submitted_at` ascendente: se atiende primero lo que lleva mas tiempo
   * esperando. Los demas estados, por `created_at` descendente.
   */
  async listar(
    actor: ActorDelEquipo,
    query: ListStaffPostsDto,
  ): Promise<PaginaDelEquipo> {
    const estado = query.estado ?? 'pendiente';
    const limit = Math.min(query.limit ?? DEFAULT_POSTS_PAGE, MAX_POSTS_PAGE);
    // El cursor se valida antes de consultar nada: un 400 no depende del alcance.
    const cursor = decodificarCursor(query.cursor);

    const modelos = await modelosAlAlcance(this.empleadas, actor);
    if (modelos && modelos.length === 0) {
      return { items: [], nextCursor: null };
    }

    const cola = estado === 'pendiente';
    const columna = cola ? 'p.submitted_at' : 'p.created_at';
    const params: unknown[] = [estado];
    const condiciones = [`p.status = $1`];
    if (modelos) {
      params.push(modelos);
      condiciones.push(`p.employee_id = ANY($${params.length}::uuid[])`);
    }
    if (query.employeeId) {
      params.push(query.employeeId);
      condiciones.push(`p.employee_id = $${params.length}::uuid`);
    }
    if (cursor) {
      params.push(cursor.fecha, cursor.id);
      condiciones.push(
        `(${columna}, p.id) ${cola ? '>' : '<'} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    // Uno de mas para saber si queda otra pagina sin un COUNT aparte.
    params.push(limit + 1);
    const orden = cola ? 'ASC' : 'DESC';

    const filas = await this.leerPosts(
      this.dataSource,
      columna,
      condiciones,
      `ORDER BY ${columna} ${orden}, p.id ${orden} LIMIT $${params.length}`,
      params,
    );
    const hayMas = filas.length > limit;
    const pagina = hayMas ? filas.slice(0, limit) : filas;
    const ultima = pagina[pagina.length - 1];
    return {
      items: pagina.map(aPostDelEquipo),
      nextCursor:
        hayMas && ultima?.cursor_at
          ? codificarCursor({ fecha: ultima.cursor_at, id: ultima.id })
          : null,
    };
  }

  async obtener(actor: ActorDelEquipo, postId: string): Promise<PostDelEquipo> {
    await this.modeloDelPostAlAlcance(actor, postId);
    return this.leerUno(postId);
  }

  // ------------------------------------------------------------- revision

  /**
   * Aprueba un post en revision. Conserva `published_at` si ya lo tenia (un
   * aprobado que se edito y volvio a revision): editar no debe subir un post
   * viejo al principio del feed.
   */
  async aprobar(actor: ActorDelEquipo, postId: string): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    const aprobados: Array<{ id: string }> = await this.dataSource.query(
      `WITH aprobado AS (
         UPDATE posts
            SET status = 'aprobado',
                reviewed_by = $3,
                reviewed_at = now(),
                published_at = COALESCE(published_at, now()),
                rejection_reason = NULL,
                updated_at = now()
          WHERE id = $1 AND employee_id = $2 AND status = 'pendiente'
         RETURNING id
       )
       SELECT id FROM aprobado`,
      [postId, employeeId, actor.id],
    );
    if (!aprobados[0]) throw yaNoPendiente();
    this.avisarModelo(employeeId, postId, 'post_approved');
    return this.leerUno(postId);
  }

  async rechazar(
    actor: ActorDelEquipo,
    postId: string,
    motivo: string,
  ): Promise<PostDelEquipo> {
    const texto = (motivo ?? '').trim();
    // El DTO ya lo exige; se repite porque el CHECK de la tabla tambien lo
    // exige y un motivo vacio no le dice nada a la modelo.
    if (!texto) throw new BadRequestException('Indica el motivo del rechazo');
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    const rechazados: Array<{ id: string }> = await this.dataSource.query(
      `WITH rechazado AS (
         UPDATE posts
            SET status = 'rechazado',
                reviewed_by = $3,
                reviewed_at = now(),
                rejection_reason = $4,
                updated_at = now()
          WHERE id = $1 AND employee_id = $2 AND status = 'pendiente'
         RETURNING id
       )
       SELECT id FROM rechazado`,
      [postId, employeeId, actor.id, texto],
    );
    if (!rechazados[0]) throw yaNoPendiente();
    this.avisarModelo(employeeId, postId, 'post_rejected');
    return this.leerUno(postId);
  }

  /** Saca un post del feed o de la cola. Solo desde donde lo permite la maquina de estados. */
  async archivar(
    actor: ActorDelEquipo,
    postId: string,
  ): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    const actual = await this.leerEstado(this.dataSource, postId, employeeId);
    if (!puedeTransicionar(actual.status, 'archivado')) {
      throw new ConflictException(
        actual.status === 'archivado'
          ? 'El post ya está archivado'
          : 'Este post no se puede archivar en su estado actual',
      );
    }
    const archivados: Array<{ id: string }> = await this.dataSource.query(
      `WITH archivado AS (
         UPDATE posts
            SET status = 'archivado', archived_at = now(), updated_at = now()
          WHERE id = $1 AND employee_id = $2 AND status = $3
         RETURNING id
       )
       SELECT id FROM archivado`,
      [postId, employeeId, actual.status],
    );
    if (!archivados[0]) throw cambioConcurrente();
    return this.leerUno(postId);
  }

  // ------------------------------------------------- publicar como el equipo

  async crear(
    actor: ActorDelEquipo,
    input: { employeeId: string; caption: string },
  ): Promise<PostDelEquipo> {
    if (!(await modeloAlAlcance(this.empleadas, actor, input.employeeId))) {
      throw new NotFoundException(MODELO_NO_ENCONTRADA);
    }
    const post = await this.postsService.crearBorrador({
      employeeId: input.employeeId,
      authorUserId: actor.id,
      authorRole: actor.rol === 'admin' ? 'admin' : 'jefe',
      caption: input.caption,
    });
    return this.leerUno(post.id);
  }

  async editarCaption(
    actor: ActorDelEquipo,
    postId: string,
    caption: string,
  ): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    await this.postsService.editarCaption(postId, employeeId, caption);
    return this.leerUno(postId);
  }

  async agregarMedia(
    actor: ActorDelEquipo,
    postId: string,
    media: NuevaMedia,
  ): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    await this.postsService.agregarMedia(postId, employeeId, media);
    return this.leerUno(postId);
  }

  async quitarMedia(
    actor: ActorDelEquipo,
    postId: string,
    mediaId: string,
  ): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    await this.postsService.quitarMedia(postId, employeeId, mediaId);
    return this.leerUno(postId);
  }

  async reordenarMedia(
    actor: ActorDelEquipo,
    postId: string,
    ids: string[],
  ): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    await this.postsService.reordenarMedia(postId, employeeId, ids);
    return this.leerUno(postId);
  }

  async borrar(
    actor: ActorDelEquipo,
    postId: string,
  ): Promise<ResultadoDeBorrar> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    return this.postsService.borrar(postId, employeeId);
  }

  /**
   * Publica un post escrito por un jefe o un admin: se aprueba al enviarlo.
   *
   * No hay transicion directa a `aprobado`, asi que en una transaccion se
   * encadenan los dos pasos permitidos (`borrador -> pendiente -> aprobado`;
   * un rechazado pasa por borrador como en `PostsService.enviar`), cada uno con
   * su UPDATE condicionado y la fila bloqueada. Si cualquiera falla, el
   * ROLLBACK deja el post como estaba.
   *
   * Un post de la modelo no se publica por aqui: necesita la revision de
   * `aprobar`. `published_at` se conserva si el post ya estuvo publicado, por
   * la misma razon que en `aprobar`.
   */
  async publicar(
    actor: ActorDelEquipo,
    postId: string,
  ): Promise<PostDelEquipo> {
    const employeeId = await this.modeloDelPostAlAlcance(actor, postId);
    await this.dataSource.transaction(async (manager) => {
      const actual = await this.leerEstado(manager, postId, employeeId, true);
      if (!AUTORES_DEL_EQUIPO.includes(actual.authorRole)) {
        throw new ConflictException(
          'Un post de la modelo se aprueba desde la cola de revisión, no se publica directamente',
        );
      }
      if (!ORIGENES_DE_PUBLICACION.includes(actual.status)) {
        throw new ConflictException(
          actual.status === 'pendiente'
            ? 'El post ya está en revisión; apruébalo desde la cola'
            : 'Solo se puede publicar un borrador o un post rechazado',
        );
      }
      if (!puedeTransicionar('borrador', 'pendiente', actual)) {
        throw new BadRequestException(
          'El post necesita al menos una foto o un video para publicarse',
        );
      }

      const enRevision: Array<{ id: string }> = await manager.query(
        `WITH enviado AS (
           UPDATE posts p
              SET status = 'pendiente',
                  submitted_at = now(),
                  rejection_reason = NULL,
                  updated_at = now()
            WHERE p.id = $1 AND p.employee_id = $2 AND p.status = $3
              AND EXISTS (SELECT 1 FROM post_media m WHERE m.post_id = p.id)
           RETURNING p.id
         )
         SELECT id FROM enviado`,
        [postId, employeeId, actual.status],
      );
      if (!enRevision[0]) throw cambioConcurrente();

      const aprobados: Array<{ id: string }> = await manager.query(
        `WITH aprobado AS (
           UPDATE posts
              SET status = 'aprobado',
                  reviewed_by = $3,
                  reviewed_at = now(),
                  published_at = COALESCE(published_at, now()),
                  updated_at = now()
            WHERE id = $1 AND employee_id = $2 AND status = 'pendiente'
           RETURNING id
         )
         SELECT id FROM aprobado`,
        [postId, employeeId, actor.id],
      );
      if (!aprobados[0]) throw cambioConcurrente();
    });
    return this.leerUno(postId);
  }

  // ------------------------------------------------------------ auxiliares

  /** Modelo del post si le toca a quien pregunta; 404 en cualquier otro caso. */
  private async modeloDelPostAlAlcance(
    actor: ActorDelEquipo,
    postId: string,
  ): Promise<string> {
    const employeeId = await this.postsService.modeloDelPost(postId);
    if (!(await modeloAlAlcance(this.empleadas, actor, employeeId))) {
      throw new NotFoundException(POST_NO_ENCONTRADO);
    }
    return employeeId;
  }

  private async leerEstado(
    ejecutor: Ejecutor,
    postId: string,
    employeeId: string,
    bloquear = false,
  ): Promise<{
    status: PostStatus;
    authorRole: PostAuthorRole;
    medias: number;
  }> {
    // Sin agregados en la misma sentencia: `FOR UPDATE` no los admite.
    const filas: Array<{ status: PostStatus; author_role: PostAuthorRole }> =
      await ejecutor.query(
        `SELECT status, author_role FROM posts
          WHERE id = $1 AND employee_id = $2${bloquear ? ' FOR UPDATE' : ''}`,
        [postId, employeeId],
      );
    if (!filas[0]) throw new NotFoundException(POST_NO_ENCONTRADO);
    const conteos: Array<{ medias: number }> = await ejecutor.query(
      `SELECT count(*)::int AS medias FROM post_media WHERE post_id = $1`,
      [postId],
    );
    return {
      status: filas[0].status,
      authorRole: filas[0].author_role,
      medias: Number(conteos[0]?.medias ?? 0),
    };
  }

  private async leerUno(postId: string): Promise<PostDelEquipo> {
    const filas = await this.leerPosts(
      this.dataSource,
      'p.created_at',
      ['p.id = $1::uuid'],
      '',
      [postId],
    );
    if (!filas[0]) throw new NotFoundException(POST_NO_ENCONTRADO);
    return aPostDelEquipo(filas[0]);
  }

  /**
   * Posts con su modelo y su media en una sola consulta (la media agregada
   * por post con `json_agg`, sin consultas por fila). `columna` es la fecha
   * por la que se pagina; va en el cursor en texto con microsegundos, porque
   * un `Date` de JavaScript solo guarda milisegundos y saltaria posts.
   */
  private leerPosts(
    ejecutor: Ejecutor,
    columna: string,
    condiciones: string[],
    cola: string,
    params: unknown[],
  ): Promise<FilaPost[]> {
    return ejecutor.query(
      `SELECT p.id, p.caption, p.status, p.rejection_reason, p.submitted_at,
              p.reviewed_at, p.published_at, p.created_at, p.like_count,
              p.author_role,
              to_char(${columna} AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
              e.id AS employee_id, e.nombre_artistico, e.foto_perfil_url,
              (SELECT json_agg(json_build_object(
                        'id', m.id,
                        'kind', m.kind,
                        'url', m.url,
                        'posterUrl', m.poster_url,
                        'width', m.width,
                        'height', m.height,
                        'durationMs', m.duration_ms,
                        'position', m.position)
                      ORDER BY m.position)
               FROM post_media m
               WHERE m.post_id = p.id) AS media
       FROM posts p
       INNER JOIN empleadas e ON e.id = p.employee_id
       WHERE ${condiciones.join(' AND ')}
       ${cola}`,
      params,
    );
  }

  /**
   * Aviso a la modelo de la decision sobre su post. Despues del UPDATE y sin
   * lanzar nunca: la decision ya esta guardada y un aviso perdido no la
   * deshace. `eventId` distingue cada decision sobre el mismo post para el
   * deduplicado permanente de los avisos push.
   */
  private avisarModelo(
    employeeId: string,
    postId: string,
    type: 'post_approved' | 'post_rejected',
  ): void {
    try {
      this.realtime.emitToEmployee(employeeId, {
        type,
        data: { postId, eventId: randomUUID() },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar a la modelo del post ${postId}: ${describeError(error)}`,
      );
    }
  }
}

function aPostDelEquipo(fila: FilaPost): PostDelEquipo {
  return {
    id: fila.id,
    caption: fila.caption,
    status: fila.status,
    rejectionReason: fila.rejection_reason,
    submittedAt: fila.submitted_at,
    reviewedAt: fila.reviewed_at,
    publishedAt: fila.published_at,
    createdAt: fila.created_at,
    likeCount: Number(fila.like_count),
    authorRole: fila.author_role,
    employee: {
      id: fila.employee_id,
      nombreArtistico: fila.nombre_artistico,
      fotoPerfilUrl: fila.foto_perfil_url,
    },
    // Un borrador puede no tener media y `json_agg` sin filas devuelve NULL.
    media: fila.media ?? [],
  };
}

function yaNoPendiente(): ConflictException {
  return new ConflictException(
    'El post ya no está pendiente de revisión; otra persona pudo decidirlo antes',
  );
}

function cambioConcurrente(): ConflictException {
  return new ConflictException(
    'El post cambió mientras se guardaba; vuelve a cargarlo e inténtalo de nuevo',
  );
}

/** Opaco para el cliente: base64url de `fecha|id`. */
export function codificarCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.fecha}|${cursor.id}`).toString('base64url');
}

export function decodificarCursor(valor?: string): Cursor | null {
  if (!valor) return null;
  const texto = Buffer.from(valor, 'base64url').toString('utf8');
  const separador = texto.indexOf('|');
  const fecha = texto.slice(0, separador);
  const id = texto.slice(separador + 1);
  if (
    separador < 1 ||
    !FECHA_DEL_CURSOR.test(fecha) ||
    Number.isNaN(Date.parse(fecha)) ||
    !UUID.test(id)
  ) {
    throw new BadRequestException('Cursor inválido');
  }
  return { fecha, id };
}
