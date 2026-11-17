"use server";

import { redirect } from "next/navigation";

import {
  destinoTrasEntrar,
  errorAlCambiarContrasenaPropia,
  errorAlRestablecer,
  RUTA_LOGIN,
  validarContrasenaNueva,
} from "@/lib/acceso-personal";
import { apiFetch, ApiError } from "@/lib/api-server";
import { getCurrentUser, isRedirectError } from "@/lib/auth";

export type ResultadoDeContrasenaPropia =
  | { success: true }
  | { success: false; error: string };

export type ResultadoDelRestablecimiento =
  | { success: true; passwordTemporal: string }
  | { success: false; error: string };

/**
 * Cambio de contraseña propio del personal (`PATCH /users/me/password`).
 *
 * El cliente tiene su propio endpoint (`client-accounts/me/password`) y su
 * propio formulario en `/cuenta`; este responde 403 a su rol.
 *
 * Con `forzado` es la salida de la pantalla bloqueante: tras el exito navega
 * al inicio del rol desde el servidor, en la misma respuesta, igual que el
 * login. El backend ya quito la marca, asi que el middleware le deja pasar.
 * Sin `forzado` (los ajustes) se queda en la pantalla y se avisa del exito.
 *
 * Se valida otra vez aqui aunque el formulario ya lo haga: una Server Action
 * se puede invocar sin pasar por el.
 */
export async function cambiarContrasenaPropiaAction(
  actual: string,
  nueva: string,
  opciones: { forzado?: boolean } = {},
): Promise<ResultadoDeContrasenaPropia> {
  const invalida = validarContrasenaNueva(actual, nueva);
  if (invalida) return { success: false, error: invalida };

  let destino: string | null = null;
  try {
    // Se lee antes del cambio: el rol decide a donde ir despues.
    const usuario = opciones.forzado ? await getCurrentUser() : null;
    await apiFetch<void>("/users/me/password", {
      method: "PATCH",
      body: JSON.stringify({ actual, nueva }),
    });
    if (opciones.forzado) {
      destino = destinoTrasEntrar({ rol: usuario?.rol }) ?? RUTA_LOGIN;
    }
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return {
        success: false,
        error: errorAlCambiarContrasenaPropia(error.status, error.message),
      };
    }
    console.error("cambiarContrasenaPropiaAction error:", error);
    return { success: false, error: errorAlCambiarContrasenaPropia(null) };
  }

  // Fuera del `try`: la redireccion viaja como excepcion y el `catch` la
  // convertiria en un error del formulario.
  if (destino) redirect(destino);
  return { success: true };
}

/**
 * Restablece la contraseña de otra persona con una temporal
 * (`POST /users/:id/reset-password`).
 *
 * La temporal vuelve una sola vez y no se guarda en ningun sitio de este lado:
 * no se registra, no se cachea y no se revalida ninguna pagina con ella. Quien
 * puede hacerlo sobre quien (admin a todo el personal, jefe solo a las modelos
 * de su equipo) lo decide el backend; aqui solo se traduce su respuesta.
 */
export async function restablecerContrasenaAction(
  usuarioId: string,
): Promise<ResultadoDelRestablecimiento> {
  if (!usuarioId) return { success: false, error: errorAlRestablecer(404) };

  try {
    const respuesta = await apiFetch<{ passwordTemporal?: unknown }>(
      `/users/${encodeURIComponent(usuarioId)}/reset-password`,
      { method: "POST" },
    );
    if (typeof respuesta?.passwordTemporal !== "string" || !respuesta.passwordTemporal) {
      return { success: false, error: errorAlRestablecer(500) };
    }
    return { success: true, passwordTemporal: respuesta.passwordTemporal };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return { success: false, error: errorAlRestablecer(error.status) };
    }
    // Sin el error en el registro: no lleva la temporal, pero tampoco aporta.
    console.error("restablecerContrasenaAction: sin respuesta del backend");
    return { success: false, error: errorAlRestablecer(null) };
  }
}
