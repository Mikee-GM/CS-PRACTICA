import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Clientes } from '../clients/entities/client.entity';
import {
  condicionModeloVisible,
  joinUsuarioDeModelo,
} from '../employees/modelo-visible';
import type { PostMediaKind } from '../posts/entities/post-media.entity';
import { DEFAULT_FEED_PAGE, ListFeedDto } from './dto/list-feed.dto';

/**
 * Lo que el cliente ve de la modelo en el feed: lo mismo que ya publica el
 * catalogo y que muestra la bandeja del chat. Nunca el nombre real ni el
 * contacto.
 */
export type ModeloDelFeed = {
  id: string;
  nombreArtistico: string;
  slugCatalogo: string;
  fotoPerfilUrl: string | null;
};

export type MediaDelFeed = {
  id: string;
  kind: PostMediaKind;
  url: string;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  position: number;
};

export type PostDelFeed = {
  id: string;
  caption: string;
  publishedAt: Date;
  likeCount: number;
  likedByMe: boolean;
  employee: ModeloDelFeed;
  media: MediaDelFeed[];
};

export type PaginaDelFeed = {
  items: PostDelFeed[];
  nextCursor: string | null;
};

export type EstadoDelLike = { liked: boolean; likeCount: number };

type FilaPost = {
  id: string;
  caption: string;
  published_at: Date;
  cursor_at: string;
  like_count: number;
  liked_by_me: boolean;
  employee_id: string;
  nombre_artistico: string;
  slug_catalogo: string;
  foto_perfil_url: string | null;
  media: MediaDelFeed[] | null;
};

type Cursor = { publishedAt: string; id: string };

export const SIN_DECLARACION_DE_EDAD =
  'Para ver las publicaciones tienes que confirmar que eres mayor de edad';

const POST_NO_ENCONTRADO = 'Publicación no encontrada';

// `published_at` con microsegundos y en UTC, tal como lo produce `cursor_at`.
const FECHA_DEL_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Feed de posts visto por el cliente: el general, el de una modelo y los
 * likes.
 *
 * Toda operacion parte de la ficha `Clientes` de la sesion y exige la
 * declaracion 18+ guardada en ella: el rol `cliente` por si solo no basta.
 * Un post que no esta aprobado, o cuya modelo no es visible, responde 404
 * igual que uno inexistente, para no revelar que existe.
 */
@Injectable()
export class FeedService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
  ) {}

  async listFeed(
    usuarioId: string,
    query: ListFeedDto,
  ): Promise<PaginaDelFeed> {
    const clienteId = await this.resolveClienteMayorDeEdad(usuarioId);
    const cursor = decodificarCursor(query.cursor);
    return this.leerPagina(clienteId, null, cursor, query.limit);
  }

  /** Posts de una modelo; oculta o inexistente responde 404. */
  async listModelFeed(
    usuarioId: string,
    slug: string,
    query: ListFeedDto,
  ): Promise<PaginaDelFeed> {
    const clienteId = await this.resolveClienteMayorDeEdad(usuarioId);
    // El cursor se valida antes de buscar a la modelo: un 400 no debe
    // depender de que el slug exista.
    const cursor = decodificarCursor(query.cursor);
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT e.id
       FROM empleadas e
       ${joinUsuarioDeModelo('e', 'u')}
       WHERE e.slug_catalogo = $1
         AND ${condicionModeloVisible('e', 'u')}`,
      [slug],
    );
    if (filas.length === 0) {
      throw new NotFoundException('Modelo no disponible');
    }
    return this.leerPagina(clienteId, filas[0].id, cursor, query.limit);
  }

  /**
   * Da like. Idempotente: repetirlo no suma otra vez (la llave primaria
   * `(post_id, client_id)` absorbe el conflicto).
   */
  async like(usuarioId: string, postId: string): Promise<EstadoDelLike> {
    const clienteId = await this.resolveClienteMayorDeEdad(usuarioId);
    await this.mutarLike(
      postId,
      clienteId,
      `INSERT INTO post_likes (post_id, client_id)
       SELECT v.id, $2::uuid FROM visible v
       ON CONFLICT (post_id, client_id) DO NOTHING
       RETURNING 1`,
    );
    return { liked: true, likeCount: await this.leerLikeCount(postId) };
  }

  /** Quita el like. Idempotente: quitar uno que no existe no falla. */
  async unlike(usuarioId: string, postId: string): Promise<EstadoDelLike> {
    const clienteId = await this.resolveClienteMayorDeEdad(usuarioId);
    await this.mutarLike(
      postId,
      clienteId,
      `DELETE FROM post_likes l
       USING visible v
       WHERE l.post_id = v.id AND l.client_id = $2::uuid
       RETURNING 1`,
    );
    return { liked: false, likeCount: await this.leerLikeCount(postId) };
  }

  /**
   * Comprueba que el post sea visible y aplica la mutacion en la misma
   * sentencia: un post que se oculta justo entonces no recibe el like. Un CTE
   * que modifica datos se ejecuta aunque la consulta principal no lo lea.
   */
  private async mutarLike(
    postId: string,
    clienteId: string,
    mutacion: string,
  ): Promise<void> {
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `WITH visible AS (
         SELECT p.id
         FROM posts p
         INNER JOIN empleadas e ON e.id = p.employee_id
         ${joinUsuarioDeModelo('e', 'u')}
         WHERE p.id = $1::uuid
           AND p.status = 'aprobado'
           AND ${condicionModeloVisible('e', 'u')}
       ), mutacion AS (
         ${mutacion}
       )
       SELECT id FROM visible`,
      [postId, clienteId],
    );
    if (filas.length === 0) throw new NotFoundException(POST_NO_ENCONTRADO);
  }

  /**
   * Va en una sentencia aparte a proposito: dentro del mismo WITH se leeria
   * la foto previa al trigger que mantiene `like_count`.
   */
  private async leerLikeCount(postId: string): Promise<number> {
    const filas: Array<{ like_count: number }> = await this.dataSource.query(
      `SELECT like_count FROM posts WHERE id = $1::uuid`,
      [postId],
    );
    if (filas.length === 0) throw new NotFoundException(POST_NO_ENCONTRADO);
    return Number(filas[0].like_count);
  }

  /**
   * Una pagina en una sola consulta: la modelo por JOIN, `likedByMe` por un
   * EXISTS sobre la llave primaria de `post_likes` y la media agregada por
   * post, sin consultas por fila.
   *
   * Pagina por `(published_at, id)` descendente, comparado como tupla en la
   * base (lo cubre el indice parcial del feed). El cursor lleva la fecha en
   * texto con microsegundos: un `Date` de JavaScript solo guarda milisegundos
   * y, al volver, saltaria posts publicados en el mismo milisegundo.
   */
  private async leerPagina(
    clienteId: string,
    employeeId: string | null,
    cursor: Cursor | null,
    limit: number = DEFAULT_FEED_PAGE,
  ): Promise<PaginaDelFeed> {
    const params: unknown[] = [clienteId];
    const condiciones: string[] = [];
    // Los filtros opcionales se añaden solo si existen, en vez de
    // `$n IS NULL OR ...`, para que el planificador vea un predicado simple
    // sobre el indice.
    if (employeeId) {
      params.push(employeeId);
      condiciones.push(`p.employee_id = $${params.length}::uuid`);
    }
    if (cursor) {
      params.push(cursor.publishedAt, cursor.id);
      condiciones.push(
        `(p.published_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    // Se pide uno de mas para saber si queda otra pagina sin un COUNT aparte.
    params.push(limit + 1);

    const filas: FilaPost[] = await this.dataSource.query(
      `SELECT p.id, p.caption, p.published_at, p.like_count,
              to_char(p.published_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
              EXISTS (
                SELECT 1 FROM post_likes l
                WHERE l.post_id = p.id AND l.client_id = $1::uuid
              ) AS liked_by_me,
              e.id AS employee_id, e.nombre_artistico, e.slug_catalogo,
              e.foto_perfil_url,
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
       ${joinUsuarioDeModelo('e', 'u')}
       WHERE p.status = 'aprobado'
         ${condiciones.map((condicion) => `AND ${condicion}`).join('\n         ')}
         AND ${condicionModeloVisible('e', 'u')}
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT $${params.length}`,
      params,
    );

    const hayMas = filas.length > limit;
    const pagina = hayMas ? filas.slice(0, limit) : filas;
    const ultima = pagina[pagina.length - 1];
    return {
      items: pagina.map(aPostDelFeed),
      nextCursor:
        hayMas && ultima
          ? codificarCursor({ publishedAt: ultima.cursor_at, id: ultima.id })
          : null,
    };
  }

  /**
   * Ficha del cliente de la sesion con su declaracion 18+. Sin ficha, 404
   * (como el chat); con ficha pero sin declaracion, 403: la cuenta existe
   * pero no puede ver contenido para adultos.
   */
  private async resolveClienteMayorDeEdad(usuarioId: string): Promise<string> {
    const cliente = await this.clientesRepository.findOne({
      where: { usuarioId },
      select: { id: true, mayorDeEdadDeclaradoAt: true },
    });
    if (!cliente) {
      throw new NotFoundException('Esta cuenta no tiene ficha de cliente');
    }
    if (!cliente.mayorDeEdadDeclaradoAt) {
      throw new ForbiddenException(SIN_DECLARACION_DE_EDAD);
    }
    return cliente.id;
  }
}

function aPostDelFeed(fila: FilaPost): PostDelFeed {
  return {
    id: fila.id,
    caption: fila.caption,
    publishedAt: fila.published_at,
    likeCount: Number(fila.like_count),
    likedByMe: Boolean(fila.liked_by_me),
    employee: {
      id: fila.employee_id,
      nombreArtistico: fila.nombre_artistico,
      slugCatalogo: fila.slug_catalogo,
      fotoPerfilUrl: fila.foto_perfil_url,
    },
    // Un post aprobado siempre tiene media (la transicion lo exige), pero un
    // `json_agg` sin filas devuelve NULL y el cliente espera una lista.
    media: fila.media ?? [],
  };
}

/** Opaco para el cliente: base64url de `published_at|id`. */
export function codificarCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.publishedAt}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodificarCursor(valor?: string): Cursor | null {
  if (!valor) return null;
  const texto = Buffer.from(valor, 'base64url').toString('utf8');
  const separador = texto.indexOf('|');
  const publishedAt = texto.slice(0, separador);
  const id = texto.slice(separador + 1);
  if (
    separador < 1 ||
    !FECHA_DEL_CURSOR.test(publishedAt) ||
    Number.isNaN(Date.parse(publishedAt)) ||
    !UUID.test(id)
  ) {
    throw new BadRequestException('Cursor del feed inválido');
  }
  return { publishedAt, id };
}
