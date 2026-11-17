import type { MediaDelPost } from "@/lib/posts";

/**
 * Tipos y reglas puras de la cola de publicaciones vista por el equipo (jefes
 * y admins), en `/jefe/publicaciones` y `/admin/publicaciones`.
 *
 * Aparte de los componentes por lo mismo que `chats-del-equipo.ts`: lo que
 * decide algo --que botones se ofrecen en cada estado, cuando se considera
 * revisada una media, que se recarga con cada evento, como se traduce un
 * 409-- se prueba sin DOM. Un error aqui se ve como un post aprobado sin que
 * nadie viera su video, o como un boton que solo enseña un 409.
 */

export type EstadoDelPost = "borrador" | "pendiente" | "aprobado" | "rechazado" | "archivado";

export type AutorDelPost = "empleada" | "jefe" | "admin";

export type PostDelEquipo = {
  id: string;
  caption: string;
  status: EstadoDelPost;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  likeCount: number;
  authorRole: AutorDelPost;
  employee: { id: string; nombreArtistico: string; fotoPerfilUrl: string | null };
  media: MediaDelPost[];
};

export type ColaDePosts = {
  items: PostDelEquipo[];
  /** Opaco: se devuelve tal cual al backend, nunca se interpreta. */
  nextCursor: string | null;
};

/** Estados que la cola deja filtrar. Los borradores no son asunto del equipo. */
export type EstadoFiltrable = Exclude<EstadoDelPost, "borrador">;

export const ESTADO_POR_DEFECTO: EstadoFiltrable = "pendiente";

/** El backend corta en 50. */
export const LIMITE_DE_LA_COLA = 50;
export const MAX_MOTIVO_DE_RECHAZO = 500;

// ----------------------------------------------------------------- etiquetas

const ETIQUETAS_DE_ESTADO: Record<EstadoDelPost, string> = {
  borrador: "Borrador",
  pendiente: "Por revisar",
  aprobado: "Publicada",
  rechazado: "Rechazada",
  archivado: "Archivada",
};

export function etiquetaDeEstadoDelPost(status: EstadoDelPost): string {
  return ETIQUETAS_DE_ESTADO[status] ?? status;
}

/** Filtros de la cola, en el orden en que se ofrecen. El primero es el de entrada. */
export const FILTROS_DE_LA_COLA: ReadonlyArray<{ valor: EstadoFiltrable; etiqueta: string }> = [
  { valor: "pendiente", etiqueta: "Por revisar" },
  { valor: "rechazado", etiqueta: "Rechazadas" },
  { valor: "aprobado", etiqueta: "Publicadas" },
  { valor: "archivado", etiqueta: "Archivadas" },
];

export function esEstadoFiltrable(valor: unknown): valor is EstadoFiltrable {
  return FILTROS_DE_LA_COLA.some((filtro) => filtro.valor === valor);
}

const ETIQUETAS_DE_AUTOR: Record<AutorDelPost, string> = {
  empleada: "La modelo",
  jefe: "Un jefe",
  admin: "Un admin",
};

/** Quien escribio el post. Importa porque uno del equipo no lo pidio la modelo. */
export function etiquetaDeAutor(autor: AutorDelPost): string {
  return ETIQUETAS_DE_AUTOR[autor] ?? "Desconocido";
}

/**
 * Pendiente con fecha de publicacion: la modelo edito algo que ya estaba
 * publicado y volvio a la cola. Se avisa porque aprobarlo no es publicar algo
 * nuevo, sino devolver al feed un post que ya tenia likes.
 */
export function esEdicionDeAprobado(post: Pick<PostDelEquipo, "status" | "publishedAt">): boolean {
  return post.status === "pendiente" && Boolean(post.publishedAt);
}

/** "2 fotos y 1 video", para la fila y el lector de pantalla. */
export function resumenDeMedia(media: readonly Pick<MediaDelPost, "kind">[]): string {
  const fotos = media.filter((m) => m.kind === "imagen").length;
  const videos = media.filter((m) => m.kind === "video").length;
  const partes: string[] = [];
  if (fotos) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
  if (videos) partes.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return partes.length ? partes.join(" y ") : "Sin media";
}

/**
 * Tiempo que lleva algo en la cola, en palabras: "hace 5 min", "hace 3 h",
 * "hace 2 días". Es una diferencia de instantes y no depende de la zona; las
 * fechas completas se escriben aparte en hora de Mexico.
 */
export function tiempoEnCola(desde: string | null, ahora: Date = new Date()): string {
  if (!desde) return "";
  const inicio = new Date(desde).getTime();
  if (!Number.isFinite(inicio)) return "";
  const minutos = Math.max(0, Math.floor((ahora.getTime() - inicio) / 60_000));
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** "0:27" o "1:05". `null` si no hay duracion util. */
export function duracionLegible(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}

/** Tope de duracion declarado en la fase 3; el backend no lo verifica. */
export const DURACION_MAXIMA_MS = 30_000;
/** Holgura entre la duracion declarada y la real antes de avisar. */
const HOLGURA_DE_DURACION_MS = 1_500;

/**
 * Aviso sobre la duracion de un video comparando lo que declaro el navegador
 * que lo subio con lo que mide el reproductor del jefe. La declarada no se
 * verifica en el servidor, asi que la real es la unica prueba de que el video
 * respeta el tope.
 */
export function avisoDeDuracion(
  declaradaMs: number | null,
  realSegundos: number | null,
): string | null {
  if (realSegundos === null || !Number.isFinite(realSegundos) || realSegundos <= 0) return null;
  const realMs = realSegundos * 1000;
  const real = duracionLegible(realMs);
  if (realMs > DURACION_MAXIMA_MS + HOLGURA_DE_DURACION_MS) {
    return `Dura ${real}: supera los 30 segundos permitidos.`;
  }
  if (declaradaMs && Math.abs(realMs - declaradaMs) > HOLGURA_DE_DURACION_MS) {
    return `Dura ${real}, aunque se declaró ${duracionLegible(declaradaMs)}.`;
  }
  return null;
}

// ------------------------------------------------------------------- reglas

export type AccionDelPost = "aprobar" | "rechazar" | "archivar";

/**
 * Que se ofrece en cada estado, con las mismas reglas que el backend: aprobar y
 * rechazar solo desde pendiente, archivar desde pendiente o aprobado. Lo demas
 * solo se mira.
 */
export function accionesDelPost(
  post: Pick<PostDelEquipo, "status">,
): Record<AccionDelPost, boolean> {
  const pendiente = post.status === "pendiente";
  return {
    aprobar: pendiente,
    rechazar: pendiente,
    archivar: pendiente || post.status === "aprobado",
  };
}

/** Motivo limpio o el error que hay que mostrar. */
export function validarMotivo(texto: string): { motivo: string } | { error: string } {
  const motivo = texto.trim();
  if (!motivo) {
    return { error: "Escribe el motivo del rechazo: la modelo lo verá para corregir su publicación." };
  }
  if (motivo.length > MAX_MOTIVO_DE_RECHAZO) {
    return { error: `El motivo admite hasta ${MAX_MOTIVO_DE_RECHAZO} caracteres. Acórtalo.` };
  }
  return { motivo };
}

// ------------------------------------------------------- revision de la media

/**
 * Fraccion vista de un video, que no se pudo sobrepasar arrastrando la barra.
 *
 * Sale de `video.played`, los tramos que de verdad se reprodujeron: saltar al
 * final no los cubre. Los tramos pueden solaparse si se rebobina, asi que se
 * unen antes de sumar.
 */
export function fraccionReproducida(
  tramos: ReadonlyArray<readonly [number, number]>,
  duracion: number,
): number {
  if (!Number.isFinite(duracion) || duracion <= 0) return 0;
  const ordenados = tramos
    .map(([a, b]) => [Math.max(0, a), Math.min(duracion, b)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let finActual = -Infinity;
  let inicioActual = 0;
  for (const [a, b] of ordenados) {
    if (a > finActual) {
      if (finActual > -Infinity) total += finActual - inicioActual;
      inicioActual = a;
      finActual = b;
    } else if (b > finActual) {
      finActual = b;
    }
  }
  if (finActual > -Infinity) total += finActual - inicioActual;
  return Math.min(1, total / duracion);
}

/**
 * Basta con el 90 %: el ultimo fotograma a veces no cuenta como reproducido y
 * un video de 3 s no deberia exigir precision de decimas.
 */
export const FRACCION_VISTA_MINIMA = 0.9;

export function videoVisto(fraccion: number): boolean {
  return fraccion >= FRACCION_VISTA_MINIMA;
}

/** Nombre de una media para los textos: "foto 2", "video 1". */
export function nombreDeMedia(media: Pick<MediaDelPost, "kind">, indice: number): string {
  return `${media.kind === "video" ? "video" : "foto"} ${indice + 1}`;
}

/**
 * Las medias que aun no se revisaron, en orden de aparicion. Una foto cuenta
 * al verse a la vista o abrirse en grande; un video, al reproducirse casi
 * entero.
 */
export function mediasSinRevisar<M extends Pick<MediaDelPost, "id" | "kind">>(
  media: readonly M[],
  revisadas: ReadonlySet<string>,
): Array<{ media: M; indice: number }> {
  return media
    .map((m, indice) => ({ media: m, indice }))
    .filter(({ media: m }) => !revisadas.has(m.id));
}

/**
 * Por que aun no se puede aprobar, o `null` si ya se puede. Dice que media falta
 * y que hacer con ella, no solo que "falta algo".
 */
export function motivoParaNoAprobar(
  media: ReadonlyArray<Pick<MediaDelPost, "id" | "kind">>,
  revisadas: ReadonlySet<string>,
): string | null {
  const faltan = mediasSinRevisar(media, revisadas);
  if (!faltan.length) return null;
  const nombres = faltan.map(({ media: m, indice }) => nombreDeMedia(m, indice));
  const lista =
    nombres.length === 1
      ? nombres[0]
      : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  const hayVideo = faltan.some(({ media: m }) => m.kind === "video");
  return `Antes de aprobar revisa ${lista}.${
    hayVideo ? " Los videos se cuentan como vistos al reproducirlos completos." : ""
  }`;
}

// ------------------------------------------------------------------- la cola

/** Ruta del navegador para una pagina de la cola. */
export function rutaDeLaCola({
  estado = ESTADO_POR_DEFECTO,
  employeeId,
  cursor,
  limit = LIMITE_DE_LA_COLA,
}: {
  estado?: EstadoFiltrable;
  employeeId?: string | null;
  cursor?: string | null;
  limit?: number;
} = {}): string {
  const params = new URLSearchParams({ estado });
  if (employeeId) params.set("employeeId", employeeId);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(Math.min(LIMITE_DE_LA_COLA, Math.max(1, Math.trunc(limit) || 1))));
  return `/api/staff/posts?${params.toString()}`;
}

/** Une paginas sin repetir posts (una relectura puede solapar la anterior). */
export function unirCola(
  actual: readonly PostDelEquipo[],
  nuevos: readonly PostDelEquipo[],
): PostDelEquipo[] {
  const vistos = new Set(actual.map((p) => p.id));
  return [...actual, ...nuevos.filter((p) => !vistos.has(p.id))];
}

/**
 * El post que queda seleccionado al sacar uno de la cola: el siguiente, o el
 * anterior si era el ultimo. Asi se revisa en orden sin volver a la lista.
 */
export function siguienteTrasQuitar(
  lista: readonly Pick<PostDelEquipo, "id">[],
  quitadoId: string,
): string | null {
  const indice = lista.findIndex((p) => p.id === quitadoId);
  if (indice === -1) return lista[0]?.id ?? null;
  return lista[indice + 1]?.id ?? lista[indice - 1]?.id ?? null;
}

/** Modelos distintas de lo cargado, ordenadas por nombre, para el filtro. */
export function modelosDeLaCola(
  posts: readonly Pick<PostDelEquipo, "employee">[],
  conocidas: ReadonlyArray<{ id: string; nombre: string }> = [],
): Array<{ id: string; nombre: string }> {
  const mapa = new Map(conocidas.map((m) => [m.id, m.nombre]));
  for (const post of posts) mapa.set(post.employee.id, post.employee.nombreArtistico);
  return [...mapa.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Pendientes contados desde una pagina de la cola. No hay ruta de conteo: con
 * la pagina maxima llena y mas por leer se dice "50+" en vez de inventar.
 */
export function contarPendientes(pagina: ColaDePosts): { cantidad: number; hayMas: boolean } {
  return { cantidad: pagina.items.length, hayMas: Boolean(pagina.nextCursor) };
}

export function textoCortoDelContador(contador: { cantidad: number; hayMas: boolean }): string {
  return contador.hayMas ? `${contador.cantidad}+` : String(contador.cantidad);
}

/** El mismo contador para un lector de pantalla. */
export function textoDelContador(contador: { cantidad: number; hayMas: boolean }): string {
  if (contador.cantidad === 0) return "Sin publicaciones por revisar";
  const mas = contador.hayMas ? "Más de " : "";
  const una = contador.cantidad === 1 && !contador.hayMas;
  return `${mas}${contador.cantidad} ${una ? "publicación" : "publicaciones"} por revisar`;
}

// ---------------------------------------------------------- eventos en vivo

/**
 * Que hacer con un evento del canal de jefes. Solo `post_pending` habla de la
 * cola (`post_approved` y `post_rejected` van a la modelo); trae ids y nada mas,
 * asi que se relee por la API, que es la que aplica el alcance.
 *
 *  - `contador`: siempre, la insignia de pendientes cambia.
 *  - `cola`: solo si se esta mirando "Por revisar"; las demas vistas no cambian
 *    porque alguien envie un post.
 */
export function queRecargarPorEvento(
  evento: { type?: string; data?: unknown },
  estadoVisible: EstadoFiltrable | null,
): { cola: boolean; contador: boolean } | null {
  if (evento.type !== "post_pending") return null;
  const data = (evento.data ?? {}) as { postId?: unknown };
  if (typeof data.postId !== "string" || !data.postId) return null;
  return { cola: estadoVisible === "pendiente", contador: true };
}

/**
 * Evento de ventana con el que la cola avisa a la navegacion de que cambio el
 * numero de pendientes, sin esperar a la siguiente lectura de la insignia.
 */
export const EVENTO_PENDIENTES_CAMBIARON = "publicaciones:pendientes";

// ------------------------------------------------------------------ errores

export type FalloDelPost = {
  error: string;
  /** El estado cambio en el servidor: hay que releer la cola. */
  conflicto?: boolean;
};

const SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

/**
 * Traduce un fallo del backend a un texto que diga que paso y que hacer.
 *
 * Los 409 ya vienen redactados en español ("otra persona pudo decidirlo
 * antes"); se muestran tal cual y se añade que la cola se actualizo, porque la
 * pantalla la relee en seguida. El 404 cubre tanto un post borrado como uno de
 * una modelo que ya no esta a cargo de quien mira: el backend no los distingue.
 */
export function traducirFalloDelPost(
  fallo: { status?: number; message?: string } | null,
  accion: AccionDelPost,
): FalloDelPost {
  const status = fallo?.status;
  const crudo = fallo?.message?.trim() || "";
  const mensaje = crudo.startsWith("Backend request failed") ? "" : crudo.replace(/[.\s]+$/, "");

  if (status === 409) {
    return {
      conflicto: true,
      error: mensaje
        ? `${mensaje}. La cola se actualizó con su estado actual.`
        : "La publicación cambió mientras tanto. La cola se actualizó con su estado actual.",
    };
  }
  if (status === 404) {
    return {
      conflicto: true,
      error:
        "Esta publicación ya no existe o la modelo ya no está a tu cargo. La cola se actualizó.",
    };
  }
  if (status === 400) {
    if (accion === "rechazar") {
      return {
        error: `Escribe el motivo del rechazo, de 1 a ${MAX_MOTIVO_DE_RECHAZO} caracteres.`,
      };
    }
    return { error: mensaje ? `${mensaje}.` : "La petición no es válida. Recarga la página." };
  }
  if (status === 403) {
    return { error: "Tu cuenta no tiene permiso para revisar publicaciones." };
  }
  if (status === 429) {
    return { error: "Demasiadas acciones seguidas. Espera unos segundos y vuelve a intentarlo." };
  }
  return { error: SIN_CONEXION };
}
