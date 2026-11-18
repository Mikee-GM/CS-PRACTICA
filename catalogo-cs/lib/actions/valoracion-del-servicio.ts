"use server";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import type { ResumenDeConversacion } from "@/lib/conversaciones";
import type { EmployeeReportCategory } from "@/lib/types";
import {
  CATEGORIAS_DE_REPORTE,
  MOTIVOS,
  type CalificacionDelCliente,
  type MotivoDeCalificacion,
} from "@/lib/valoracion-del-servicio";

const LOGIN_CLIENTE = { loginPath: "/ingresar" } as const;

export type ResultadoDeValoracion<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      /** El servidor dijo 409: el servicio aun no termino o ya no admite la accion. */
      conflicto?: boolean;
    };

/** Un id que va a parar a la ruta del backend: solo uuids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

const ID_INVALIDO = "No se pudo enviar. Recarga la página e inténtalo de nuevo.";

/**
 * Traduce un fallo del backend a un texto que diga que hacer.
 *
 * Copia de `errorDeChat` (conversaciones.ts, privado): los 409 dependen de la
 * accion, asi que los pone quien llama.
 */
function errorDeValoracion(
  error: unknown,
  conflicto: string,
  contexto: string,
): ResultadoDeValoracion<never> {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return { success: false, error: conflicto, conflicto: true };
    }
    if (error.status === 404) {
      return {
        success: false,
        error: "No encontramos este servicio. Recarga la página para ver lo que sigue pendiente.",
      };
    }
    if (error.status === 429) {
      return {
        success: false,
        error: "Estás enviando demasiado rápido. Espera unos segundos y vuelve a intentarlo.",
      };
    }
    if (error.status === 400) {
      return { success: false, error: error.message };
    }
  }
  console.error(`${contexto} error:`, error);
  return { success: false, error: SIN_CONEXION };
}

/** Califica a una modelo del servicio; en un grupal `empleadaId` dice a cual. */
export async function calificarServicioAction(
  servicioId: string,
  input: {
    estrellas: number;
    empleadaId?: string;
    motivo?: MotivoDeCalificacion;
    comentario?: string;
  },
): Promise<ResultadoDeValoracion<CalificacionDelCliente>> {
  if (!UUID.test(servicioId) || (input.empleadaId && !UUID.test(input.empleadaId))) {
    return { success: false, error: ID_INVALIDO };
  }
  if (!Number.isInteger(input.estrellas) || input.estrellas < 1 || input.estrellas > 5) {
    return { success: false, error: "Elige de 1 a 5 estrellas." };
  }
  if (input.motivo && !MOTIVOS.some((m) => m.valor === input.motivo)) {
    return { success: false, error: "Elige un motivo de la lista." };
  }
  const comentario = input.comentario?.trim();
  if (comentario && (comentario.length < 3 || comentario.length > 2000)) {
    return {
      success: false,
      error: "El comentario debe tener entre 3 y 2000 caracteres.",
    };
  }

  try {
    const calificacion = await apiFetch<CalificacionDelCliente>(
      `/client-feedback/services/${servicioId}/rating`,
      {
        ...LOGIN_CLIENTE,
        method: "POST",
        body: JSON.stringify({
          estrellas: input.estrellas,
          ...(input.empleadaId ? { empleadaId: input.empleadaId } : {}),
          ...(input.motivo ? { motivo: input.motivo } : {}),
          ...(comentario ? { comentario } : {}),
        }),
      },
    );
    return { success: true, data: calificacion };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return errorDeValoracion(
      error,
      "Ya pasó el plazo de 24 horas para calificar este servicio.",
      "calificarServicioAction",
    );
  }
}

/** Reporta un problema del servicio; cada categoria se admite una sola vez. */
export async function reportarServicioAction(
  servicioId: string,
  input: { categoria: EmployeeReportCategory; descripcion: string },
): Promise<ResultadoDeValoracion<{ id: string }>> {
  if (!UUID.test(servicioId)) {
    return { success: false, error: ID_INVALIDO };
  }
  if (!CATEGORIAS_DE_REPORTE.includes(input.categoria)) {
    return { success: false, error: "Elige el tipo de problema." };
  }
  const descripcion = input.descripcion.trim();
  if (descripcion.length < 3 || descripcion.length > 2000) {
    return {
      success: false,
      error: "Cuéntanos qué pasó en 3 a 2000 caracteres.",
    };
  }

  try {
    const reporte = await apiFetch<{ id: string }>(
      `/client-feedback/services/${servicioId}/report`,
      {
        ...LOGIN_CLIENTE,
        method: "POST",
        body: JSON.stringify({ categoria: input.categoria, descripcion }),
      },
    );
    return { success: true, data: reporte };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return errorDeValoracion(
      error,
      "Ya enviaste un reporte de este tipo para este servicio.",
      "reportarServicioAction",
    );
  }
}

/** Abre (o recupera) el chat con la misma modelo; devuelve su resumen. */
export async function volverAContratarAction(
  servicioId: string,
): Promise<ResultadoDeValoracion<ResumenDeConversacion>> {
  if (!UUID.test(servicioId)) {
    return { success: false, error: ID_INVALIDO };
  }

  try {
    const conversacion = await apiFetch<ResumenDeConversacion>(
      `/client-feedback/services/${servicioId}/rehire`,
      { ...LOGIN_CLIENTE, method: "POST" },
    );
    return { success: true, data: conversacion };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return errorDeValoracion(
      error,
      "Este servicio aún no termina. Podrás volver a contratar cuando finalice.",
      "volverAContratarAction",
    );
  }
}
