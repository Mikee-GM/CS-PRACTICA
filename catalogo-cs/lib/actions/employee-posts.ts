"use server";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import {
  mensajeDelBackend,
  paginaDeMisPosts,
  POSTS_POR_PAGINA,
  traducirFallo,
  type OperacionDelPost,
  type PaginaDeMisPosts,
  type PostDeLaModelo,
  type ResultadoDeBorrar,
} from "@/lib/employee-posts";

/*
 * Acciones de la modelo sobre sus publicaciones (`/employee-portal/posts`).
 *
 * Van en un archivo propio y no en `employee-portal.ts`: aquellas arman la
 * peticion a mano para admitir tambien el token del enlace del bot, y esta
 * pantalla exige sesion propia (como el historial), asi que basta `apiFetch`,
 * que ya reenvia la cookie y el `x-csrf-token` que pide `PortalAuthGuard`.
 *
 * Ninguna lanza salvo por redireccion: devuelven el estado HTTP y el mensaje
 * ya traducido, porque la pantalla tiene que decir como corregir cada fallo
 * (un 409 no se arregla igual que un 413) sin conocer los textos del backend.
 */

export type ResultadoDelPost<T> =
  | { ok: true; datos: T }
  | { ok: false; status: number | null; mensaje: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id que no es UUID no sale de aqui: ira en la ruta del backend. */
function idValido(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

const ID_INVALIDO = {
  ok: false as const,
  status: 400,
  mensaje: "La publicación no es válida. Vuelve a la lista y ábrela de nuevo.",
};

async function llamar<T>(
  operacion: OperacionDelPost,
  ruta: string,
  init: RequestInit = {},
): Promise<ResultadoDelPost<T>> {
  try {
    const datos = await apiFetch<T>(`/employee-portal/posts${ruta}`, init);
    return { ok: true, datos };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return {
        ok: false,
        status: error.status,
        mensaje: traducirFallo(operacion, error.status, mensajeDelBackend(error.body)),
      };
    }
    console.error(`Fallo en publicaciones de la modelo (${operacion}):`, error);
    return { ok: false, status: null, mensaje: traducirFallo(operacion, null) };
  }
}

/** Pagina siguiente de la lista. */
export async function listarMisPublicaciones(
  cursor: string,
): Promise<ResultadoDelPost<PaginaDeMisPosts>> {
  if (!idValido(cursor)) return ID_INVALIDO;
  const params = new URLSearchParams({ limit: String(POSTS_POR_PAGINA), cursor });
  const resultado = await llamar<unknown>("listar", `?${params}`);
  return resultado.ok ? { ok: true, datos: paginaDeMisPosts(resultado.datos) } : resultado;
}

/** Crea el borrador. Se llama al guardar el texto o subir la primera media. */
export async function crearPublicacion(
  caption: string,
): Promise<ResultadoDelPost<PostDeLaModelo>> {
  return llamar("crear", "", {
    method: "POST",
    body: JSON.stringify({ caption: typeof caption === "string" ? caption : "" }),
  });
}

export async function guardarTextoDePublicacion(
  postId: string,
  caption: string,
): Promise<ResultadoDelPost<PostDeLaModelo>> {
  if (!idValido(postId)) return ID_INVALIDO;
  return llamar("guardar-texto", `/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ caption: typeof caption === "string" ? caption : "" }),
  });
}

/**
 * Sube UNA foto o UN video.
 *
 * Una por peticion porque el cuerpo de una Server Action no pasa de 20 MB y un
 * solo video puede llegar a eso. Se rearma el `FormData` con los campos que
 * admite el backend en vez de reenviar el del navegador tal cual: lo que no
 * esta en el contrato no viaja.
 */
export async function subirMediaDePublicacion(
  postId: string,
  formData: FormData,
): Promise<ResultadoDelPost<PostDeLaModelo>> {
  if (!idValido(postId)) return ID_INVALIDO;
  const archivo = formData.get("file");
  if (!(archivo instanceof Blob) || archivo.size === 0) {
    return { ok: false, status: 400, mensaje: "Falta el archivo que querías subir." };
  }

  const cuerpo = new FormData();
  cuerpo.append("file", archivo);
  const portada = formData.get("poster");
  if (portada instanceof Blob && portada.size > 0) cuerpo.append("poster", portada);
  for (const campo of ["width", "height", "durationMs"]) {
    const valor = formData.get(campo);
    if (typeof valor === "string" && /^\d{1,6}$/.test(valor)) cuerpo.append(campo, valor);
  }

  return llamar("subir", `/${postId}/media`, { method: "POST", body: cuerpo });
}

export async function quitarMediaDePublicacion(
  postId: string,
  mediaId: string,
): Promise<ResultadoDelPost<PostDeLaModelo>> {
  if (!idValido(postId) || !idValido(mediaId)) return ID_INVALIDO;
  return llamar("quitar-media", `/${postId}/media/${mediaId}`, { method: "DELETE" });
}

export async function reordenarMediaDePublicacion(
  postId: string,
  ids: string[],
): Promise<ResultadoDelPost<PostDeLaModelo>> {
  if (!idValido(postId) || !Array.isArray(ids) || !ids.every(idValido)) return ID_INVALIDO;
  return llamar("reordenar", `/${postId}/media/order`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

export async function enviarPublicacionARevision(
  postId: string,
): Promise<ResultadoDelPost<PostDeLaModelo>> {
  if (!idValido(postId)) return ID_INVALIDO;
  return llamar("enviar", `/${postId}/submit`, { method: "POST" });
}

export async function borrarPublicacion(
  postId: string,
): Promise<ResultadoDelPost<ResultadoDeBorrar>> {
  if (!idValido(postId)) return ID_INVALIDO;
  return llamar("borrar", `/${postId}`, { method: "DELETE" });
}
