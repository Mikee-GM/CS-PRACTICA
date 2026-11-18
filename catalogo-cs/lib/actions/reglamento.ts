"use server";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import type { AvanceDelCuestionario, MiReglamento } from "@/lib/reglamento";

export type ResultadoDeReglamento<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

/** El reglamento y el estado del cuestionario de quien tiene la sesion. */
export async function getMiReglamento(): Promise<MiReglamento> {
  return apiFetch<MiReglamento>("/staff-onboarding/me");
}

function fallo(error: unknown, contexto: string): ResultadoDeReglamento<never> {
  if (isRedirectError(error)) throw error;
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return {
        success: false,
        error: "Estás respondiendo demasiado rápido. Espera unos segundos.",
      };
    }
    if (error.status >= 400 && error.status < 500) {
      return { success: false, error: error.message };
    }
  }
  console.error(`${contexto} error:`, error);
  return { success: false, error: SIN_CONEXION };
}

/** Empieza el cuestionario, o retoma el intento que quedo abierto. */
export async function empezarCuestionario(): Promise<
  ResultadoDeReglamento<AvanceDelCuestionario>
> {
  try {
    const data = await apiFetch<AvanceDelCuestionario>(
      "/staff-onboarding/me/questionnaire",
      { method: "POST" },
    );
    return { success: true, data };
  } catch (error) {
    return fallo(error, "empezarCuestionario");
  }
}

/** Responde la pregunta en curso y devuelve la siguiente o el resultado. */
export async function responderPregunta(
  opcionId: string,
): Promise<ResultadoDeReglamento<AvanceDelCuestionario>> {
  try {
    const data = await apiFetch<AvanceDelCuestionario>(
      "/staff-onboarding/me/questionnaire/answers",
      { method: "POST", body: JSON.stringify({ opcionId }) },
    );
    return { success: true, data };
  } catch (error) {
    return fallo(error, "responderPregunta");
  }
}
