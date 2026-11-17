"use server";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import {
  traducirFalloDelEquipo,
  type AccionDelEquipo,
  type ControlDeConversacion,
  type DecisionSobreBorrador,
  type MensajeParaElEquipo,
} from "@/lib/chats-del-equipo";

/*
 * Acciones del equipo sobre el chat web (`/staff/conversations`). El backend
 * exige `admin` o `jefe`, CSRF y el alcance de cada jefe; aqui solo se valida
 * la forma para no mandar basura y se traduce el error a algo accionable.
 */

export type ResultadoDelEquipo<T> =
  | { success: true; data: T }
  | { success: false; error: string; conflicto?: boolean };

/** Un id que va a parar a la ruta del backend: solo uuids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ID_INVALIDO: ResultadoDelEquipo<never> = {
  success: false,
  error: "No se reconoce esta conversación. Recarga la página y vuelve a abrirla.",
};

async function llamar<T>(
  ruta: string,
  cuerpo: unknown,
  accion: AccionDelEquipo,
): Promise<ResultadoDelEquipo<T>> {
  try {
    const data = await apiFetch<T>(ruta, {
      method: "POST",
      body: JSON.stringify(cuerpo ?? {}),
    });
    return { success: true, data };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (!(error instanceof ApiError)) console.error(`chats del equipo (${accion}):`, error);
    const fallo = traducirFalloDelEquipo(
      error instanceof ApiError
        ? { status: error.status, message: error.message, body: error.body }
        : null,
      accion,
    );
    return { success: false, ...fallo };
  }
}

export async function tomarControlAction(
  conversationId: string,
  forzar = false,
): Promise<ResultadoDelEquipo<ControlDeConversacion>> {
  if (!UUID.test(conversationId)) return ID_INVALIDO;
  return llamar(
    `/staff/conversations/${conversationId}/take-over`,
    forzar ? { forzar: true } : {},
    "tomar",
  );
}

export async function devolverControlAction(
  conversationId: string,
  forzar = false,
): Promise<ResultadoDelEquipo<ControlDeConversacion>> {
  if (!UUID.test(conversationId)) return ID_INVALIDO;
  return llamar(
    `/staff/conversations/${conversationId}/release`,
    forzar ? { forzar: true } : {},
    "devolver",
  );
}

/**
 * Responde como equipo. Idempotente por `clientMessageId`: un reintento tras
 * un fallo de red no duplica el mensaje.
 */
export async function enviarMensajeDelEquipoAction(
  conversationId: string,
  input: { body: string; clientMessageId: string },
): Promise<ResultadoDelEquipo<MensajeParaElEquipo>> {
  if (!UUID.test(conversationId) || !UUID.test(input.clientMessageId)) return ID_INVALIDO;
  const body = input.body.trim();
  if (!body) return { success: false, error: "Escribe un mensaje antes de enviarlo." };
  if (body.length > 2000) {
    return {
      success: false,
      error: "El mensaje supera los 2000 caracteres. Divídelo en varios más cortos.",
    };
  }
  return llamar(
    `/staff/conversations/${conversationId}/messages`,
    { body, clientMessageId: input.clientMessageId },
    "enviar",
  );
}

export async function aceptarSolicitudAction(
  conversationId: string,
): Promise<ResultadoDelEquipo<DecisionSobreBorrador>> {
  if (!UUID.test(conversationId)) return ID_INVALIDO;
  return llamar(`/staff/conversations/${conversationId}/accept`, {}, "aceptar");
}

export async function rechazarSolicitudAction(
  conversationId: string,
  motivo?: string,
): Promise<ResultadoDelEquipo<DecisionSobreBorrador>> {
  if (!UUID.test(conversationId)) return ID_INVALIDO;
  const limpio = motivo?.trim();
  if (limpio && limpio.length > 500) {
    return { success: false, error: "El motivo admite hasta 500 caracteres. Acórtalo." };
  }
  return llamar(
    `/staff/conversations/${conversationId}/reject`,
    limpio ? { motivo: limpio } : {},
    "rechazar",
  );
}
