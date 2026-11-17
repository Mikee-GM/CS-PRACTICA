"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import {
  errorAlCambiarContrasena,
  errorAlCambiarNombre,
  validarNombre,
} from "@/lib/perfil-cliente";

export type ResultadoDelNombre =
  | { success: true; nombre: string }
  | { success: false; error: string };

export type ResultadoDeContrasena =
  | { success: true }
  | { success: false; error: string };

const LOGIN_CLIENTE = { loginPath: "/ingresar" } as const;

/**
 * Guarda el nombre del cliente.
 *
 * Se valida otra vez aqui aunque el formulario ya lo haga: una Server Action
 * se puede invocar sin pasar por el. La sesion caducada viaja como redireccion
 * y se relanza para que el `catch` no la convierta en un error del formulario.
 */
export async function actualizarNombreAction(
  nombre: string,
): Promise<ResultadoDelNombre> {
  const validado = validarNombre(nombre);
  if (!validado.valido) return { success: false, error: validado.error };

  try {
    const respuesta = await apiFetch<{ nombre: string }>("/client-accounts/me", {
      ...LOGIN_CLIENTE,
      method: "PATCH",
      body: JSON.stringify({ nombre: validado.nombre }),
    });
    revalidatePath("/cuenta");
    return { success: true, nombre: respuesta?.nombre ?? validado.nombre };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return { success: false, error: errorAlCambiarNombre(error.status) };
    }
    console.error("actualizarNombreAction error:", error);
    return { success: false, error: errorAlCambiarNombre(null) };
  }
}

/**
 * Cambia la contraseña. El backend cierra las demas sesiones del cliente y
 * conserva la actual, asi que no hay nada que refrescar en esta pantalla.
 */
export async function cambiarContrasenaAction(
  actual: string,
  nueva: string,
): Promise<ResultadoDeContrasena> {
  if (!actual || !nueva) {
    return { success: false, error: "Escribe tu contraseña actual y la nueva." };
  }

  try {
    await apiFetch<void>("/client-accounts/me/password", {
      ...LOGIN_CLIENTE,
      method: "POST",
      body: JSON.stringify({ actual, nueva }),
    });
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return {
        success: false,
        error: errorAlCambiarContrasena(error.status, error.message),
      };
    }
    console.error("cambiarContrasenaAction error:", error);
    return { success: false, error: errorAlCambiarContrasena(null) };
  }
}
