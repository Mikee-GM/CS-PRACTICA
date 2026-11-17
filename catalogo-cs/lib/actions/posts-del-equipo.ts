"use server";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import {
  traducirFalloDelPost,
  validarMotivo,
  type AccionDelPost,
  type PostDelEquipo,
} from "@/lib/posts-del-equipo";

/*
 * Decisiones del equipo sobre las publicaciones (`/staff/posts`). El backend
 * exige `admin` o `jefe`, CSRF y el alcance de cada jefe; aqui solo se valida
 * la forma para no mandar basura y se traduce el error a algo accionable.
 */

export type ResultadoDelPost =
  | { success: true; data: PostDelEquipo }
  | { success: false; error: string; conflicto?: boolean };

/** Un id que va a parar a la ruta del backend: solo uuids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ID_INVALIDO: ResultadoDelPost = {
  success: false,
  error: "No se reconoce esta publicación. Recarga la página y vuelve a abrirla.",
};

async function decidir(
  postId: string,
  ruta: "approve" | "reject" | "archive",
  cuerpo: object,
  accion: AccionDelPost,
): Promise<ResultadoDelPost> {
  if (!UUID.test(postId)) return ID_INVALIDO;
  try {
    const data = await apiFetch<PostDelEquipo>(`/staff/posts/${postId}/${ruta}`, {
      method: "POST",
      body: JSON.stringify(cuerpo),
    });
    return { success: true, data };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (!(error instanceof ApiError)) console.error(`publicaciones del equipo (${accion}):`, error);
    const fallo = traducirFalloDelPost(
      error instanceof ApiError ? { status: error.status, message: error.message } : null,
      accion,
    );
    return { success: false, ...fallo };
  }
}

export async function aprobarPostAction(postId: string): Promise<ResultadoDelPost> {
  return decidir(postId, "approve", {}, "aprobar");
}

/** El motivo es obligatorio: la modelo lo lee para corregir y reenviar. */
export async function rechazarPostAction(
  postId: string,
  motivo: string,
): Promise<ResultadoDelPost> {
  const validado = validarMotivo(typeof motivo === "string" ? motivo : "");
  if ("error" in validado) return { success: false, error: validado.error };
  return decidir(postId, "reject", { motivo: validado.motivo }, "rechazar");
}

export async function archivarPostAction(postId: string): Promise<ResultadoDelPost> {
  return decidir(postId, "archive", {}, "archivar");
}
