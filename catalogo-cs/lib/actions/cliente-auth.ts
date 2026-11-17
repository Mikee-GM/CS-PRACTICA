"use server";

import { redirect } from "next/navigation";

import { applyBackendSetCookies } from "@/lib/auth-cookies";
import { getApiBaseUrl, apiFetch, ApiError } from "@/lib/api-server";
import { getCurrentUser, isRedirectError } from "@/lib/auth";
import { destinoSeguroDelCliente } from "@/lib/destino-cliente";
import { inicioParaRol } from "@/lib/roles";

export type RegistroInput = {
  email: string;
  password: string;
  nombre: string;
  mayorDeEdad: boolean;
  aceptaTerminos: boolean;
};

export type ResultadoAccion = { success: true } | { success: false; error: string };

/** Los mensajes de validacion del backend llegan como lista. */
function mensajeDe(data: unknown, porDefecto: string): string {
  const message = (data as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join(", ");
  return typeof message === "string" && message ? message : porDefecto;
}

/**
 * Alta de una cuenta de cliente.
 *
 * Igual que `loginAction`, la navegacion la hace el servidor tras escribir las
 * cookies, y su excepcion de control no puede caer en el `catch`: por eso se
 * relanza. La verificacion del correo queda pendiente y no frena la entrada.
 */
export async function registroAction(
  input: RegistroInput,
  siguiente?: string | null,
): Promise<ResultadoAccion> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/auth/register`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email.trim(),
        password: input.password,
        nombre: input.nombre.trim() || undefined,
        mayorDeEdad: input.mayorDeEdad,
        aceptaTerminos: input.aceptaTerminos,
      }),
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: mensajeDe(data, "No se pudo crear la cuenta"),
      };
    }
    await applyBackendSetCookies(response);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("registroAction error:", error);
    return {
      success: false,
      error: "No se pudo conectar con el servidor. Intenta de nuevo.",
    };
  }

  // Quien se registro desde el boton "Chatear" vuelve a esa modelo.
  redirect(destinoSeguroDelCliente(siguiente) ?? inicioParaRol("cliente"));
}

/** Canjea el token del enlace del correo. Publica: no exige sesion. */
export async function verificarCorreoAction(
  token: string,
): Promise<ResultadoAccion> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/client-accounts/verify-email`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      },
    );
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => ({}));
      return {
        success: false,
        error: mensajeDe(data, "El enlace no es válido o ya venció"),
      };
    }
    return { success: true };
  } catch (error) {
    console.error("verificarCorreoAction error:", error);
    return {
      success: false,
      error: "No se pudo conectar con el servidor. Intenta de nuevo.",
    };
  }
}

export async function reenviarVerificacionAction(): Promise<ResultadoAccion> {
  try {
    await apiFetch("/client-accounts/resend-verification", {
      method: "POST",
      loginPath: "/ingresar",
    });
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) {
      return { success: false, error: error.message };
    }
    console.error("reenviarVerificacionAction error:", error);
    return { success: false, error: "No se pudo enviar el correo" };
  }
}

/**
 * Rol de quien visita el catalogo, o `null` sin sesion.
 *
 * El catalogo es estatico (ISR) y no puede saber en el render quien lo mira;
 * la cabecera lo pregunta despues de montar para elegir entre "Iniciar sesión"
 * y "Mis chats". Solo sirve para eso: no autoriza nada.
 */
export async function sesionDelVisitanteAction(): Promise<{ rol: string } | null> {
  const usuario = await getCurrentUser();
  return usuario ? { rol: usuario.rol } : null;
}
