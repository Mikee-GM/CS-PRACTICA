/**
 * Publicaciones de la modelo vistas desde su portal: tipos del contrato y
 * logica pura.
 *
 * Igual que `lib/posts.ts` para el feed, todo lo que se decide sin DOM vive
 * aqui y se prueba en `employee-posts.spec.ts` con el entorno `node`: que dice
 * cada estado, que se puede hacer con el, que se avisa antes de editar o de
 * borrar, como se explica un error del backend y si un archivo cabe antes de
 * gastar los datos del telefono en subirlo. Los componentes de
 * `components/empleada/posts/` solo pintan y llaman.
 *
 * Las reglas de media (topes, tipos) no se repiten: salen de `REGLAS_DE_MEDIA`.
 */

import {
  REGLAS_DE_MEDIA,
  tipoDeMediaLocal,
  type MediaDelPost,
  type TipoDeMedia,
} from "@/lib/posts";

export type EstadoDelPost =
  | "borrador"
  | "pendiente"
  | "aprobado"
  | "rechazado"
  | "archivado";

/** `PostDeLaModelo` del backend (`GET /employee-portal/posts`). */
export interface PostDeLaModelo {
  id: string;
  caption: string;
  status: EstadoDelPost;
  rejectionReason: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  likeCount: number;
  /** Ordenada por `position`. */
  media: MediaDelPost[];
}

export interface PaginaDeMisPosts {
  items: PostDeLaModelo[];
  /** Opaco: se devuelve tal cual al backend. */
  nextCursor: string | null;
}

export interface ResultadoDeBorrar {
  id: string;
  resultado: "borrado" | "archivado";
}

/** Tamaño de pagina de la lista; el backend admite hasta 50. */
export const POSTS_POR_PAGINA = 12;

export const MAXIMO_DEL_TEXTO = 2000;

// ---------------------------------------------------------------------------
// Estado y acciones
// ---------------------------------------------------------------------------

export type TonoDelEstado = "neutro" | "revision" | "publicada" | "rechazada";

export interface EtiquetaDeEstado {
  texto: string;
  tono: TonoDelEstado;
}

/**
 * Lo que dice la insignia de cada publicacion.
 *
 * El motivo del rechazo va en la propia etiqueta y no en un aviso aparte: en
 * una lista de varias, un aviso suelto no dejaria claro cual hay que corregir.
 * Un archivado no se lista (el backend no lo devuelve), pero si llega se dice
 * lo que es en vez de inventar otro estado.
 */
export function etiquetaDeEstado(
  post: Pick<PostDeLaModelo, "status" | "rejectionReason">,
): EtiquetaDeEstado {
  switch (post.status) {
    case "borrador":
      return { texto: "Borrador", tono: "neutro" };
    case "pendiente":
      return { texto: "En revisión", tono: "revision" };
    case "aprobado":
      return { texto: "Publicada", tono: "publicada" };
    case "rechazado": {
      const motivo = post.rejectionReason?.trim();
      return {
        texto: motivo ? `Rechazada: ${motivo}` : "Rechazada",
        tono: "rechazada",
      };
    }
    case "archivado":
      return { texto: "Archivada", tono: "neutro" };
  }
}

/**
 * Motivo de un rechazo anterior que sigue guardado en un borrador.
 *
 * Un rechazado que se edita vuelve a borrador y conserva el motivo hasta que se
 * reenvia: es justo lo que la modelo necesita tener delante mientras corrige.
 */
export function motivoPendienteDeCorregir(
  post: Pick<PostDeLaModelo, "status" | "rejectionReason">,
): string | null {
  if (post.status !== "borrador") return null;
  return post.rejectionReason?.trim() || null;
}

export interface AccionesDelPost {
  /** Cambiar texto o media. */
  editar: boolean;
  /** Mandar a revision. Exige al menos una media. */
  enviar: boolean;
  /** Que hace el boton de borrar, o `null` si no hay. */
  borrar: "eliminar" | "archivar" | null;
}

export function accionesDisponibles(
  post: Pick<PostDeLaModelo, "status" | "media">,
): AccionesDelPost {
  const conMedia = post.media.length > 0;
  switch (post.status) {
    case "borrador":
    case "rechazado":
      return { editar: true, enviar: conMedia, borrar: "eliminar" };
    case "pendiente":
    case "aprobado":
      return { editar: true, enviar: false, borrar: "archivar" };
    case "archivado":
      return { editar: false, enviar: false, borrar: null };
  }
}

/**
 * Si editar este post necesita confirmacion previa.
 *
 * Solo el publicado: cualquier cambio lo saca del feed hasta que se apruebe de
 * nuevo, y eso hay que saberlo antes de tocar, no descubrirlo despues.
 */
export function editarPideConfirmacion(status: EstadoDelPost): boolean {
  return status === "aprobado";
}

export const AVISO_EDITAR_PUBLICADA =
  "Esta publicación está visible en el feed. Si cambias el texto o las fotos, dejará de verse hasta que coordinación la apruebe de nuevo. Conserva sus me gusta.";

/** Aviso fijo del editor segun el estado, o `null` si no hay nada que avisar. */
export function avisoDelEditor(status: EstadoDelPost): string | null {
  switch (status) {
    case "aprobado":
      return AVISO_EDITAR_PUBLICADA;
    case "pendiente":
      return "Está en revisión. Puedes seguir haciendo cambios; coordinación revisará la versión más reciente.";
    case "rechazado":
      return "Si haces cambios, volverá a borrador. Cuando esté lista, envíala de nuevo a revisión.";
    default:
      return null;
  }
}

export interface AvisoDeBorrado {
  titulo: string;
  descripcion: string;
  etiquetaConfirmar: string;
}

/**
 * Lo que se dice antes de borrar, que no es lo mismo segun el estado.
 *
 * Un borrador o un rechazado se borran de verdad, con su media. Uno en
 * revision o publicado se archiva: deja de verse, pero el registro (y sus me
 * gusta) quedan del lado de coordinacion.
 */
export function avisoAlBorrar(status: EstadoDelPost): AvisoDeBorrado | null {
  const accion = accionesDisponibles({ status, media: [] }).borrar;
  if (accion === "eliminar") {
    return {
      titulo: "Eliminar publicación",
      descripcion:
        "Se eliminará definitivamente, con todas sus fotos y videos. No se puede deshacer.",
      etiquetaConfirmar: "Eliminar",
    };
  }
  if (accion === "archivar") {
    return {
      titulo: "Archivar publicación",
      descripcion:
        status === "aprobado"
          ? "Se archivará y dejará de verse en el feed. Ya no podrás editarla ni volver a publicarla."
          : "Se archivará y saldrá de la revisión. Ya no podrás editarla ni enviarla de nuevo.",
      etiquetaConfirmar: "Archivar",
    };
  }
  return null;
}

/** Texto de confirmacion tras borrar, segun lo que hizo el backend. */
export function mensajeTrasBorrar(resultado: ResultadoDeBorrar["resultado"]): string {
  return resultado === "archivado"
    ? "Publicación archivada. Ya no se ve en el feed."
    : "Publicación eliminada.";
}

// ---------------------------------------------------------------------------
// Errores del backend
// ---------------------------------------------------------------------------

/** Que se estaba haciendo cuando fallo: cambia lo que hay que sugerir. */
export type OperacionDelPost =
  | "listar"
  | "crear"
  | "guardar-texto"
  | "subir"
  | "quitar-media"
  | "reordenar"
  | "enviar"
  | "borrar";

/** El mensaje de NestJS puede venir como texto o como lista de textos. */
export function mensajeDelBackend(cuerpo: unknown): string | null {
  const m = (cuerpo as { message?: unknown } | null)?.message;
  if (typeof m === "string" && m.trim()) return m.trim();
  if (Array.isArray(m)) {
    const partes = m.filter((p): p is string => typeof p === "string" && p.trim() !== "");
    if (partes.length > 0) return partes.join(". ");
  }
  return null;
}

/**
 * Traduce un fallo a un mensaje que dice que paso y como seguir.
 *
 * `status` es `null` cuando ni siquiera hubo respuesta. En los 400 se usa el
 * texto del backend porque es el que sabe que limite se rompio (diez archivos,
 * tres videos, video sin portada) y ya viene en español; si no trae texto, se
 * cae a uno generico. Los 409 y 404 no se fian del texto del backend, que
 * habla de "post" y de cargas: aqui se le dice a la modelo que recargue.
 */
export function traducirFallo(
  operacion: OperacionDelPost,
  status: number | null,
  mensaje: string | null = null,
): string {
  if (status === null) {
    return "No hay conexión con el servidor. Revisa tu internet y vuelve a intentarlo.";
  }
  if (status === 413) {
    return `El archivo pesa más de ${megas(REGLAS_DE_MEDIA.maximoBytesVideo)} MB. Si es un video, recórtalo o compártelo con menos calidad desde la galería del teléfono y vuelve a elegirlo.`;
  }
  if (status === 429) {
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.";
  }
  if (status === 404) {
    return operacion === "listar"
      ? "No encontramos tu ficha de modelo. Si acabas de entrar, cierra sesión y vuelve a entrar."
      : "Esta publicación ya no existe. Vuelve a la lista para ver cómo quedó.";
  }
  if (status === 409) {
    if (operacion === "enviar") {
      return "Esta publicación ya está en revisión o cambió de estado. Vuelve a la lista para ver cómo quedó.";
    }
    return "La publicación cambió mientras guardabas o ya no se puede editar. Vuelve a la lista y ábrela de nuevo.";
  }
  if (status === 400 || status === 422) {
    if (mensaje) return mensaje;
    if (operacion === "enviar") {
      return "Añade al menos una foto o un video antes de enviarla a revisión.";
    }
    if (operacion === "subir") {
      return "El archivo no es válido. Usa fotos JPEG, PNG o WEBP o videos MP4 o WebM.";
    }
    return "Revisa los datos e inténtalo de nuevo.";
  }
  if (status === 401 || status === 403) {
    return "Tu sesión terminó. Vuelve a entrar al portal.";
  }
  return "No se pudo completar. Inténtalo de nuevo en un momento.";
}

// ---------------------------------------------------------------------------
// Antes de subir
// ---------------------------------------------------------------------------

/**
 * Cuerpo maximo de una peticion: el `bodySizeLimit` de las Server Actions y el
 * `middlewareClientMaxBodySize` de `next.config.ts`. Un video y su portada
 * viajan juntos, asi que es el total lo que tiene que caber, no solo el video.
 */
export const LIMITE_POR_PETICION = 20 * 1024 * 1024;

/** Margen para las cabeceras del multipart y los campos de texto. */
export const MARGEN_DEL_MULTIPART = 64 * 1024;

export function megas(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  // Sin decimales cuando es exacto ("20 MB"); con uno cuando no ("19,6 MB").
  return Number.isInteger(mb)
    ? String(mb)
    : (Math.round(mb * 10) / 10).toLocaleString("es-MX");
}

/** Si un archivo (y su portada) caben en una sola peticion. */
export function cabeEnUnaPeticion(bytes: number, bytesPortada = 0): boolean {
  return bytes + bytesPortada + MARGEN_DEL_MULTIPART <= LIMITE_POR_PETICION;
}

/** Duracion de `HTMLMediaElement.duration` en milisegundos, o `null`. */
export function duracionEnMs(segundos: number): number | null {
  // Un WebM grabado con MediaRecorder suele traer `Infinity` hasta reproducirse.
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  return Math.max(1, Math.round(segundos * 1000));
}

/**
 * Segundo del que se saca la portada de un video.
 *
 * No el 0: muchos videos del telefono arrancan en negro o con el fundido de la
 * camara. Medio segundo basta para salir de eso, y en un video mas corto se
 * toma la mitad.
 */
export function momentoDeLaPortada(segundos: number): number {
  if (!Number.isFinite(segundos) || segundos <= 0) return 0;
  return Math.min(0.5, segundos / 2);
}

/** Tope del lado mayor de la portada: es una miniatura, no una foto. */
export const LADO_MAXIMO_DE_LA_PORTADA = 1280;

/** Tamaño del lienzo de la portada conservando la proporcion del video. */
export function tamanoDeLaPortada(
  ancho: number,
  alto: number,
  maximo = LADO_MAXIMO_DE_LA_PORTADA,
): { ancho: number; alto: number } | null {
  if (!(ancho > 0) || !(alto > 0)) return null;
  const escala = Math.min(1, maximo / Math.max(ancho, alto));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

/** Dimension en pixeles tal como la admite el backend (entero 1..20000). */
export function dimensionValida(valor: number | null | undefined): number | null {
  if (valor == null || !Number.isFinite(valor)) return null;
  const entero = Math.round(valor);
  return entero >= 1 && entero <= 20_000 ? entero : null;
}

export interface CupoDeMedia {
  medias: number;
  videos: number;
}

/** Cuantas fotos y videos mas admite el post. */
export function cupoRestante(
  media: readonly Pick<MediaDelPost, "kind">[],
): CupoDeMedia {
  const videos = media.filter((m) => m.kind === "video").length;
  return {
    medias: Math.max(0, REGLAS_DE_MEDIA.maximoDeMedias - media.length),
    videos: Math.max(0, REGLAS_DE_MEDIA.maximoDeVideos - videos),
  };
}

/** Lo que se sabe de un archivo elegido antes de subirlo. */
export interface ArchivoElegido {
  nombre: string;
  /** `File.type`. */
  tipo: string;
  bytes: number;
  /** Solo video; `null` si no se pudo leer. */
  duracionMs?: number | null;
  /** Solo video: peso de la portada ya generada. */
  bytesPortada?: number;
}

export type RevisionDeArchivo =
  | { ok: true; kind: TipoDeMedia }
  | { ok: false; mensaje: string };

/**
 * Decide si un archivo se puede subir, y si no, explica como arreglarlo.
 *
 * Se mira archivo por archivo porque se sube uno por peticion: lo que falla se
 * queda en la cola con su motivo y lo demas sigue. `cupo` es lo que el post
 * admite todavia contando lo que ya esta en cola delante de este.
 *
 * La imagen llega ya comprimida, asi que su peso es el que viajara. El tipo
 * real lo deciden los bytes en el backend; esto solo evita subir 20 MB que van
 * a ser rechazados.
 */
export function revisarArchivo(
  archivo: ArchivoElegido,
  cupo: CupoDeMedia,
): RevisionDeArchivo {
  const r = REGLAS_DE_MEDIA;
  const kind = tipoDeMediaLocal(archivo.tipo);
  if (!kind) {
    return {
      ok: false,
      mensaje: `"${archivo.nombre}" no es una foto JPEG, PNG o WEBP ni un video MP4 o WebM. Elige otro archivo.`,
    };
  }
  if (cupo.medias <= 0) {
    return {
      ok: false,
      mensaje: `Una publicación admite hasta ${r.maximoDeMedias} fotos o videos. Quita alguno para añadir "${archivo.nombre}".`,
    };
  }
  if (kind === "video" && cupo.videos <= 0) {
    return {
      ok: false,
      mensaje: `Una publicación admite hasta ${r.maximoDeVideos} videos. Quita uno para añadir "${archivo.nombre}".`,
    };
  }

  if (kind === "imagen") {
    if (!cabeEnUnaPeticion(archivo.bytes)) {
      return {
        ok: false,
        mensaje: `"${archivo.nombre}" pesa ${megas(archivo.bytes)} MB y no se pudo reducir. Haz una captura de la foto o expórtala con menos calidad.`,
      };
    }
    return { ok: true, kind };
  }

  const tope = megas(r.maximoBytesVideo);
  if (archivo.bytes > r.maximoBytesVideo || !cabeEnUnaPeticion(archivo.bytes, archivo.bytesPortada ?? 0)) {
    return {
      ok: false,
      mensaje: `"${archivo.nombre}" pesa ${megas(archivo.bytes)} MB y el máximo es ${tope} MB. Recórtalo o compártelo con menos calidad desde la galería del teléfono y vuelve a elegirlo.`,
    };
  }
  const duracion = archivo.duracionMs;
  if (duracion == null || !Number.isFinite(duracion)) {
    return {
      ok: false,
      mensaje: `No se pudo leer la duración de "${archivo.nombre}". Guárdalo de nuevo desde la galería o prueba con otro video.`,
    };
  }
  if (duracion > r.maximaDuracionVideoMs) {
    return {
      ok: false,
      mensaje: `"${archivo.nombre}" dura ${Math.ceil(duracion / 1000)} segundos y el máximo es ${r.maximaDuracionVideoMs / 1000}. Recórtalo desde la galería del teléfono y vuelve a elegirlo.`,
    };
  }
  return { ok: true, kind };
}

// ---------------------------------------------------------------------------
// Orden de la media
// ---------------------------------------------------------------------------

/**
 * Mueve un elemento un puesto antes (`-1`) o despues (`1`).
 *
 * Devuelve `null` si no se mueve (ya esta en el borde o no existe): asi quien
 * llama no manda al backend un orden identico, que no cambiaria nada.
 */
export function moverEnLista<T>(
  lista: readonly T[],
  indice: number,
  paso: -1 | 1,
): T[] | null {
  const destino = indice + paso;
  if (indice < 0 || indice >= lista.length) return null;
  if (destino < 0 || destino >= lista.length) return null;
  const copia = [...lista];
  [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
  return copia;
}

/** "Foto 2 de 5" o "Video 2 de 5". */
export function nombreDeMedia(kind: TipoDeMedia, indice: number, total: number): string {
  return `${kind === "video" ? "Video" : "Foto"} ${indice + 1} de ${total}`;
}

/** Lo que se anuncia tras mover: el resultado, no el mecanismo. */
export function anuncioTrasMover(kind: TipoDeMedia, nuevoIndice: number, total: number): string {
  const quien = kind === "video" ? "Video movido" : "Foto movida";
  return `${quien} a la posición ${nuevoIndice + 1} de ${total}.`;
}

/** "0:12": duracion corta de un video para su miniatura. */
export function duracionCorta(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

/** Sustituye un post por su version nueva, o lo pone primero si no estaba. */
export function conPostActualizado(
  lista: readonly PostDeLaModelo[],
  post: PostDeLaModelo,
): PostDeLaModelo[] {
  const indice = lista.findIndex((p) => p.id === post.id);
  if (indice === -1) return [post, ...lista];
  const copia = [...lista];
  copia[indice] = post;
  return copia;
}

/** Añade una pagina sin duplicar lo que ya esta en pantalla. */
export function unirMisPosts(
  actuales: readonly PostDeLaModelo[],
  nuevos: readonly PostDeLaModelo[],
): PostDeLaModelo[] {
  const vistos = new Set(actuales.map((p) => p.id));
  return [...actuales, ...nuevos.filter((p) => !vistos.has(p.id) && vistos.add(p.id))];
}

/** Normaliza una pagina recibida; lo que no tenga forma se lee como vacia. */
export function paginaDeMisPosts(respuesta: unknown): PaginaDeMisPosts {
  const r = respuesta as Partial<PaginaDeMisPosts> | null;
  return {
    items: Array.isArray(r?.items) ? r.items.filter((p) => p.status !== "archivado") : [],
    nextCursor: typeof r?.nextCursor === "string" && r.nextCursor ? r.nextCursor : null,
  };
}

/** Contador del texto: "120 / 2000". */
export function contadorDelTexto(texto: string): string {
  return `${texto.length} / ${MAXIMO_DEL_TEXTO}`;
}
