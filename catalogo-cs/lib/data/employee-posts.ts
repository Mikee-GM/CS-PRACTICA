import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import {
  paginaDeMisPosts,
  POSTS_POR_PAGINA,
  traducirFallo,
  type PaginaDeMisPosts,
} from "@/lib/employee-posts";

/**
 * Primera pagina de las publicaciones de la modelo, para el render de
 * `/empleada/posts`. Las siguientes las pide la lista con una Server Action.
 *
 * No lanza salvo por redireccion: un fallo no es lo mismo que no tener
 * publicaciones, y si se aplanara a una lista vacia (como haria
 * `optionalSource`) la modelo veria "Todavia no has publicado nada" con el
 * backend caido. Las redirecciones de `apiFetch` (sesion caducada) se
 * reemiten.
 */
export type LecturaDeMisPosts =
  | { estado: "ok"; pagina: PaginaDeMisPosts }
  | { estado: "error"; mensaje: string };

export async function getMisPublicaciones(): Promise<LecturaDeMisPosts> {
  try {
    const respuesta = await apiFetch<unknown>(
      `/employee-portal/posts?limit=${POSTS_POR_PAGINA}`,
    );
    return { estado: "ok", pagina: paginaDeMisPosts(respuesta) };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return { estado: "error", mensaje: traducirFallo("listar", error.status) };
    }
    console.error("No se pudieron leer las publicaciones de la modelo:", error);
    return { estado: "error", mensaje: traducirFallo("listar", null) };
  }
}
