"use server";

import { ApiError, apiFetch } from "@/lib/api-server";
import {
  TOKEN_CANDIDATA,
  type EvaluacionPublica,
  type RespuestaEvaluacion,
  type ResultadoRespuesta,
} from "@/lib/candidata";

// Sin sesion a proposito: la candidata no tiene cuenta y el token del enlace
// es su unica credencial.

export async function leerEvaluacion(
  token: string,
): Promise<EvaluacionPublica | null> {
  if (!TOKEN_CANDIDATA.test(token)) return null;
  try {
    return await apiFetch<EvaluacionPublica>(
      `/candidate-screening/public/${encodeURIComponent(token)}`,
      { authenticated: false },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function responderEvaluacion(
  token: string,
  respuesta: RespuestaEvaluacion,
): Promise<ResultadoRespuesta> {
  if (!TOKEN_CANDIDATA.test(token)) return null;
  try {
    return await apiFetch<ResultadoRespuesta>(
      `/candidate-screening/public/${encodeURIComponent(token)}/answers`,
      {
        method: "POST",
        body: JSON.stringify(respuesta),
        authenticated: false,
      },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return null;
      // Otra pestana o un doble envio ya respondio esa pregunta: la UI relee.
      if (error.status === 409) return { conflicto: true };
    }
    throw error;
  }
}
