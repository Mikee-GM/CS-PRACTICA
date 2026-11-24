import { ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import type { ResultadoAccion } from "@/lib/resultado-accion";

/**
 * Motivo legible de un fallo del backend.
 *
 * Los errores de validacion llegan como lista de mensajes; se unen en una sola
 * frase. Cualquier otra cosa cae en el texto por defecto, que va en espanol.
 */
export function motivoDelFallo(error: unknown, porDefecto: string): string {
  if (error instanceof ApiError) {
    const mensaje = (error.body as { message?: unknown } | undefined)?.message;
    if (Array.isArray(mensaje)) return mensaje.join(". ");
    if (typeof mensaje === "string" && mensaje) return mensaje;
    return error.message || porDefecto;
  }
  return porDefecto;
}

/**
 * Ejecuta una accion del servidor y devuelve su resultado como valor.
 *
 * Las redirecciones de Next se vuelven a lanzar: `apiFetch` corta la sesion
 * llamando a `redirect`, y tragarsela dejaria al usuario viendo un error en vez
 * de la pantalla de ingreso.
 */
export async function ejecutarAccion<T>(
  accion: () => Promise<T>,
  porDefecto: string,
): Promise<ResultadoAccion<T>> {
  try {
    return { ok: true, data: await accion() };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: motivoDelFallo(error, porDefecto) };
  }
}
