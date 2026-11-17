import type { PostStatus } from './entities/post.entity';

/** Topes de un post. Viven aqui para que backend y validaciones compartan cifra. */
export const MAX_MEDIAS = 10;
export const MAX_VIDEOS = 3;
// Igual al limite de body de Next: subir mas exige URLs prefirmadas.
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
// Declarado por el navegador, no verificado (ver `PostMedia.durationMs`).
export const MAX_VIDEO_SEGUNDOS = 30;
// Coincide con `ck_posts_caption_length` de la migracion.
export const MAX_CAPTION = 2000;

/**
 * Transiciones permitidas. `aprobado -> pendiente` es la edicion de un post
 * publicado: vuelve a revision y se oculta, pero conserva sus likes porque la
 * fila es la misma. `archivado` es terminal: archivar es el "borrar" de la
 * modelo para lo ya publicado o en revision (un pendiente puede ser un
 * aprobado editado, con sus likes), y desarchivar sin revision lo devolveria
 * al feed sin que nadie lo vea antes.
 */
const TRANSICIONES: Record<PostStatus, readonly PostStatus[]> = {
  borrador: ['pendiente'],
  pendiente: ['aprobado', 'rechazado', 'archivado'],
  rechazado: ['borrador'],
  aprobado: ['archivado', 'pendiente'],
  archivado: [],
};

/**
 * Indica si un post puede pasar de `desde` a `hacia`. Todo paso a `pendiente`
 * exige al menos una media, porque el feed solo admite posts con foto o
 * video; sin `contexto` se asume que no hay ninguna, para que olvidar el dato
 * nunca deje pasar un post vacio a revision.
 */
export function puedeTransicionar(
  desde: PostStatus,
  hacia: PostStatus,
  contexto: { medias: number } = { medias: 0 },
): boolean {
  if (!TRANSICIONES[desde].includes(hacia)) return false;
  if (hacia === 'pendiente') return contexto.medias >= 1;
  return true;
}

/**
 * Estado en el que queda un post al editarlo, o `null` si no se puede editar.
 * Lo aprobado vuelve a revision; lo rechazado vuelve a borrador para que la
 * modelo lo corrija y lo envie de nuevo; lo pendiente sigue pendiente (el jefe
 * revisa la ultima version).
 */
export function siguienteAlEditar(estado: PostStatus): PostStatus | null {
  switch (estado) {
    case 'borrador':
      return 'borrador';
    case 'pendiente':
      return 'pendiente';
    case 'rechazado':
      return 'borrador';
    case 'aprobado':
      return 'pendiente';
    case 'archivado':
      return null;
  }
}

export function esVisibleEnFeed(estado: PostStatus): boolean {
  return estado === 'aprobado';
}
