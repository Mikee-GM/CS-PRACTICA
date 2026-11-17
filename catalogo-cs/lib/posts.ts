/**
 * Feed de publicaciones: tipos del contrato y logica pura.
 *
 * Todo lo que se puede decidir sin DOM vive aqui y se prueba en `posts.spec.ts`
 * con el entorno `node`: union de paginas, estado del me gusta, validacion de la
 * media que sube la modelo y los textos que dependen de la zona del negocio.
 * Los componentes de `components/feed/` solo pintan y llaman.
 */

import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/locale";

export type TipoDeMedia = "imagen" | "video";

export interface MediaDelPost {
  id: string;
  kind: TipoDeMedia;
  url: string;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  position: number;
}

export interface ModeloDelPost {
  id: string;
  nombreArtistico: string;
  slugCatalogo: string;
  fotoPerfilUrl: string | null;
}

export interface PostDelFeed {
  id: string;
  caption: string;
  publishedAt: string;
  likeCount: number;
  likedByMe: boolean;
  employee: ModeloDelPost;
  media: MediaDelPost[];
}

export interface PaginaDeFeed {
  items: PostDelFeed[];
  /** Opaco: se devuelve tal cual al backend, nunca se interpreta. */
  nextCursor: string | null;
}

/** Respuesta de `PUT` y `DELETE /feed/posts/:id/like`. */
export interface EstadoMeGusta {
  liked: boolean;
  likeCount: number;
}

// ---------------------------------------------------------------------------
// Paginas
// ---------------------------------------------------------------------------

/** El backend corta en 20; pedir mas solo serviria para que lo rechace. */
export const LIMITE_MAXIMO_DEL_FEED = 20;
export const LIMITE_POR_DEFECTO_DEL_FEED = 10;

/**
 * Ruta del navegador para una pagina del feed general o del perfil de una
 * modelo. El slug y el cursor van codificados: el slug del catalogo se captura
 * a mano en el panel y no tiene un formato garantizado.
 */
export function rutaDelFeed({
  slug,
  cursor,
  limit = LIMITE_POR_DEFECTO_DEL_FEED,
}: {
  slug?: string | null;
  cursor?: string | null;
  limit?: number;
} = {}): string {
  const base = slug ? `/api/feed/models/${encodeURIComponent(slug)}` : "/api/feed";
  const tope = Math.min(
    LIMITE_MAXIMO_DEL_FEED,
    Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : LIMITE_POR_DEFECTO_DEL_FEED)),
  );
  const params = new URLSearchParams({ limit: String(tope) });
  if (cursor) params.set("cursor", cursor);
  return `${base}?${params}`;
}

/**
 * Añade una pagina nueva a lo que ya esta en pantalla.
 *
 * Lo que ya estaba conserva su sitio y sus datos: entre una pagina y la
 * siguiente pueden publicarse posts nuevos, y segun como corte el backend uno
 * ya visto puede reaparecer. Sustituirlo moveria la lista bajo el dedo y, peor,
 * pisaria con un `likedByMe` viejo el me gusta que la persona acaba de dar.
 * Los repetidos dentro de la misma pagina tambien se descartan.
 */
export function unirPaginas(
  actuales: readonly PostDelFeed[],
  nuevos: readonly PostDelFeed[],
): PostDelFeed[] {
  const vistos = new Set(actuales.map((p) => p.id));
  const resultado = [...actuales];
  for (const post of nuevos) {
    if (vistos.has(post.id)) continue;
    vistos.add(post.id);
    resultado.push(post);
  }
  return resultado;
}

/** La media en el orden que eligio quien publico, sin mutar la original. */
export function mediaOrdenada(media: readonly MediaDelPost[]): MediaDelPost[] {
  return [...media].sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Me gusta
// ---------------------------------------------------------------------------

/**
 * El me gusta se modela como "lo que confirmo el servidor" mas "lo que quiere
 * la persona". Lo que se pinta sale de los dos, y la peticion que falta tambien.
 *
 * Asi un doble toque rapido no deja dos peticiones cruzadas: mientras una va en
 * camino solo cambia el deseo, y al volver se manda (o no) la siguiente. Si
 * algo falla, el deseo vuelve a lo confirmado y la pantalla se corrige sola.
 */
export function meGustaVisible(
  confirmado: EstadoMeGusta,
  deseado: boolean,
): EstadoMeGusta {
  if (deseado === confirmado.liked) return confirmado;
  const delta = deseado ? 1 : -1;
  return {
    liked: deseado,
    likeCount: Math.max(0, confirmado.likeCount + delta),
  };
}

/** Que hay que pedirle al servidor para llegar al deseo, o nada. */
export function accionPendiente(
  confirmado: EstadoMeGusta,
  deseado: boolean,
): "PUT" | "DELETE" | null {
  if (deseado === confirmado.liked) return null;
  return deseado ? "PUT" : "DELETE";
}

/**
 * Normaliza la respuesta del servidor. Si viene incompleta no se inventa nada:
 * se queda lo confirmado antes, que es lo ultimo cierto que se sabe.
 */
export function reconciliarMeGusta(
  previo: EstadoMeGusta,
  respuesta: unknown,
): EstadoMeGusta {
  const r = respuesta as Partial<EstadoMeGusta> | null;
  if (
    !r ||
    typeof r.liked !== "boolean" ||
    typeof r.likeCount !== "number" ||
    !Number.isFinite(r.likeCount)
  ) {
    return previo;
  }
  return { liked: r.liked, likeCount: Math.max(0, Math.trunc(r.likeCount)) };
}

/** Mensaje para la persona segun el estado HTTP con el que fallo el me gusta. */
export function errorDelMeGusta(status: number | null): string {
  if (status === 404) return "Esta publicación ya no está disponible.";
  if (status === 429) return "Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.";
  return "No se pudo guardar tu me gusta. Revisa tu conexión y vuelve a intentarlo.";
}

const NUMERO = new Intl.NumberFormat(APP_LOCALE);

export function textoDeMeGusta(cantidad: number): string {
  return `${NUMERO.format(cantidad)} me gusta`;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

function diaEnElNegocio(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

/**
 * Fecha corta de publicacion en hora de Mexico: la hora si es de hoy, dia y mes
 * si es de este año, y con el año si es de antes.
 */
export function fechaDelPost(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  if (diaEnElNegocio(fecha) === diaEnElNegocio(ahora)) {
    return new Intl.DateTimeFormat(APP_LOCALE, {
      timeZone: APP_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    }).format(fecha);
  }
  const mismoAnio = diaEnElNegocio(fecha).slice(0, 4) === diaEnElNegocio(ahora).slice(0, 4);
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
    ...(mismoAnio ? {} : { year: "numeric" }),
  }).format(fecha);
}

/** Fecha completa, para el `title` del `<time>`. */
export function fechaCompletaDelPost(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    dateStyle: "long",
    timeStyle: "short",
  }).format(fecha);
}

/** "Imagen 2 de 5" o "Video 2 de 5": lo que oye un lector de pantalla. */
export function etiquetaDeDiapositiva(
  kind: TipoDeMedia,
  indice: number,
  total: number,
): string {
  return `${kind === "video" ? "Video" : "Imagen"} ${indice + 1} de ${total}`;
}

/**
 * Proporcion de la caja del carrusel, de la primera media.
 *
 * Una sola caja para todas las diapositivas: si cada una tuviera la suya, el
 * texto de abajo saltaria al pasar de una foto vertical a una apaisada. Se
 * acota entre 4:5 y 1.91:1, como hacen las redes, para que un video muy alto no
 * ocupe tres pantallas. Sin dimensiones se supone 4:5, el caso mas comun.
 */
export const PROPORCION_MINIMA = 4 / 5;
export const PROPORCION_MAXIMA = 1.91;

export function proporcionDelCarrusel(media: readonly MediaDelPost[]): number {
  const primera = mediaOrdenada(media)[0];
  if (!primera?.width || !primera?.height) return PROPORCION_MINIMA;
  const proporcion = primera.width / primera.height;
  return Math.min(PROPORCION_MAXIMA, Math.max(PROPORCION_MINIMA, proporcion));
}

/** Login con regreso a la pantalla del feed en la que estaba. */
export function loginConRegreso(ruta: string): string {
  return `/ingresar?siguiente=${encodeURIComponent(ruta)}`;
}

/** Ruta del perfil publico de una modelo. */
export function rutaDelPerfil(slug: string): string {
  return `/modelos/${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------
// Media que sube la modelo (portal, F3)
// ---------------------------------------------------------------------------

/**
 * Reglas de la media de un post. Son las mismas que aplica el backend; aqui
 * solo sirven para avisar antes de subir 20 MB que van a ser rechazados. El
 * backend sigue decidiendo por los bytes, no por el tipo que declara el
 * navegador.
 *
 * `video/quicktime` se deja pasar: un MOV solo se acepta si por dentro es MP4
 * compatible, y eso no se puede saber desde el tipo declarado.
 */
export const REGLAS_DE_MEDIA = {
  maximoDeMedias: 10,
  maximoDeVideos: 3,
  maximoBytesVideo: 20 * 1024 * 1024,
  maximaDuracionVideoMs: 30_000,
  tiposDeImagen: ["image/jpeg", "image/png", "image/webp"],
  tiposDeVideo: ["video/mp4", "video/webm", "video/quicktime"],
} as const;

/** Lo minimo que hace falta saber de un archivo local para validarlo. */
export interface MediaLocal {
  /** Tipo declarado por el navegador (`File.type`). */
  tipo: string;
  bytes: number;
  /** Solo videos; `null` si no se pudo leer la duracion. */
  duracionMs?: number | null;
}

export interface ErrorDeMedia {
  /** Indice del archivo, o `null` si el error es del conjunto. */
  indice: number | null;
  mensaje: string;
}

export function tipoDeMediaLocal(tipo: string): TipoDeMedia | null {
  const t = tipo.toLowerCase();
  if ((REGLAS_DE_MEDIA.tiposDeImagen as readonly string[]).includes(t)) return "imagen";
  if ((REGLAS_DE_MEDIA.tiposDeVideo as readonly string[]).includes(t)) return "video";
  return null;
}

/** Valor del atributo `accept` del selector de archivos. */
export const ACEPTA_MEDIA = [
  ...REGLAS_DE_MEDIA.tiposDeImagen,
  ...REGLAS_DE_MEDIA.tiposDeVideo,
].join(",");

export function validarMediaLocal(archivos: readonly MediaLocal[]): ErrorDeMedia[] {
  const errores: ErrorDeMedia[] = [];
  const r = REGLAS_DE_MEDIA;

  if (archivos.length === 0) {
    errores.push({ indice: null, mensaje: "Añade al menos una foto o un video." });
  }
  if (archivos.length > r.maximoDeMedias) {
    errores.push({
      indice: null,
      mensaje: `Una publicación admite hasta ${r.maximoDeMedias} archivos.`,
    });
  }

  let videos = 0;
  archivos.forEach((archivo, indice) => {
    const numero = indice + 1;
    const tipo = tipoDeMediaLocal(archivo.tipo);
    if (!tipo) {
      errores.push({
        indice,
        mensaje: `El archivo ${numero} no es una imagen JPEG, PNG o WEBP ni un video MP4 o WebM.`,
      });
      return;
    }
    if (tipo === "imagen") return;

    videos += 1;
    if (archivo.bytes > r.maximoBytesVideo) {
      errores.push({
        indice,
        mensaje: `El video ${numero} pesa más de ${r.maximoBytesVideo / (1024 * 1024)} MB.`,
      });
    }
    const duracion = archivo.duracionMs;
    if (duracion == null || !Number.isFinite(duracion)) {
      errores.push({
        indice,
        mensaje: `No se pudo leer la duración del video ${numero}. Prueba con otro archivo.`,
      });
    } else if (duracion > r.maximaDuracionVideoMs) {
      errores.push({
        indice,
        mensaje: `El video ${numero} dura más de ${r.maximaDuracionVideoMs / 1000} segundos.`,
      });
    }
  });

  if (videos > r.maximoDeVideos) {
    errores.push({
      indice: null,
      mensaje: `Una publicación admite hasta ${r.maximoDeVideos} videos.`,
    });
  }
  return errores;
}
