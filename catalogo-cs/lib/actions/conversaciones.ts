"use server";

import { redirect } from "next/navigation";

import { apiFetch, ApiError } from "@/lib/api-server";
import { getCurrentUser, isRedirectError } from "@/lib/auth";
import type {
  MensajeDelChat,
  ResumenDeConversacion,
  UbicacionDelMensaje,
} from "@/lib/conversaciones";

const LOGIN_CLIENTE = { loginPath: "/ingresar" } as const;

export type ResultadoDeChat<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      /** El servidor dijo 409: la conversacion esta cerrada o no espera nada. */
      conflicto?: boolean;
    };

/** Un id que va a parar a la ruta del backend: solo uuids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

/**
 * Traduce un fallo del backend a un texto que diga que hacer.
 *
 * Los 409 dependen de la accion, asi que los pone quien llama. El resto son
 * comunes: un 404 aqui solo puede ser una conversacion ajena o borrada, y un
 * 429 es el limite de ritmo del backend.
 */
function errorDeChat(
  error: unknown,
  conflicto: string,
  contexto: string,
): ResultadoDeChat<never> {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return { success: false, error: conflicto, conflicto: true };
    }
    if (error.status === 404) {
      return {
        success: false,
        error: "No encontramos esta conversación. Vuelve a tus chats y ábrela de nuevo.",
      };
    }
    if (error.status === 429) {
      return {
        success: false,
        error: "Estás enviando demasiado rápido. Espera unos segundos y vuelve a intentarlo.",
      };
    }
    if (error.status === 400 || error.status === 413 || error.status === 415) {
      return { success: false, error: error.message };
    }
  }
  console.error(`${contexto} error:`, error);
  return { success: false, error: SIN_CONEXION };
}

/**
 * Abre (o recupera) la conversacion con una modelo y lleva a ella.
 *
 * Sin sesion no se manda al login desde aqui: lo decide el boton del catalogo,
 * que sabe a que pantalla volver despues. Una cuenta del personal no puede
 * chatear como cliente; el backend la rechazaria igual, pero el mensaje propio
 * dice que hacer en vez de un "Forbidden".
 */
export async function abrirChatAction(
  employeeId: string,
): Promise<ResultadoDeChat<never> & { requiereSesion?: boolean }> {
  if (!UUID.test(employeeId)) {
    return { success: false, error: "Esta modelo ya no está disponible en el catálogo." };
  }

  const usuario = await getCurrentUser();
  if (!usuario) {
    return { success: false, error: "Inicia sesión para chatear.", requiereSesion: true };
  }
  if (usuario.rol !== "cliente") {
    return {
      success: false,
      error: "Tu cuenta es del equipo. Para chatear, entra con una cuenta de cliente.",
    };
  }

  let conversacionId: string;
  try {
    const conversacion = await apiFetch<ResumenDeConversacion>("/conversations", {
      ...LOGIN_CLIENTE,
      method: "POST",
      body: JSON.stringify({ employeeId }),
    });
    conversacionId = conversacion.id;
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError && error.status === 404) {
      return {
        success: false,
        error: "Esta modelo ya no está disponible en el catálogo. Elige otra.",
      };
    }
    return errorDeChat(error, SIN_CONEXION, "abrirChatAction");
  }

  // Fuera del try: la excepcion de control del redirect no puede caer en el catch.
  redirect(`/chats/${conversacionId}`);
}

/**
 * Envia un mensaje de texto o una ubicacion.
 *
 * Idempotente por `clientMessageId`: un reintento tras un fallo de red no
 * duplica el mensaje, el backend devuelve el que ya guardo.
 */
export async function enviarMensajeAction(
  conversationId: string,
  input: {
    clientMessageId: string;
    body?: string;
    location?: UbicacionDelMensaje;
  },
): Promise<ResultadoDeChat<MensajeDelChat>> {
  if (!UUID.test(conversationId) || !UUID.test(input.clientMessageId)) {
    return { success: false, error: "No se pudo enviar. Recarga la página e inténtalo de nuevo." };
  }
  const body = input.body?.trim();
  if (!body && !input.location) {
    return { success: false, error: "Escribe un mensaje antes de enviarlo." };
  }
  if (body && body.length > 2000) {
    return {
      success: false,
      error: "El mensaje supera los 2000 caracteres. Divídelo en varios más cortos.",
    };
  }

  try {
    const mensaje = await apiFetch<MensajeDelChat>(
      `/conversations/${conversationId}/messages`,
      {
        ...LOGIN_CLIENTE,
        method: "POST",
        body: JSON.stringify({
          clientMessageId: input.clientMessageId,
          ...(body ? { body } : {}),
          ...(input.location ? { location: input.location } : {}),
        }),
      },
    );
    return { success: true, data: mensaje };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return errorDeChat(
      error,
      "Esta conversación está cerrada. Abre un chat nuevo desde el catálogo para seguir.",
      "enviarMensajeAction",
    );
  }
}

/**
 * Sube una foto o una nota de voz del cliente (campo `file`; `clientMessageId`,
 * `body` en fotos y `durationMs` en audios). El tipo real lo decide el backend por
 * los bytes; aqui solo se descarta lo evidente para no subir de balde.
 */
export async function enviarMediaAction(
  conversationId: string,
  formData: FormData,
): Promise<ResultadoDeChat<MensajeDelChat>> {
  const clientMessageId = formData.get("clientMessageId");
  if (
    !UUID.test(conversationId) ||
    typeof clientMessageId !== "string" ||
    !UUID.test(clientMessageId)
  ) {
    return { success: false, error: "No se pudo enviar. Recarga la página e inténtalo de nuevo." };
  }
  const archivo = formData.get("file");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { success: false, error: "Elige una foto o graba un audio antes de enviarlo." };
  }
  if (!archivo.type.startsWith("image/") && !archivo.type.startsWith("audio/")) {
    return { success: false, error: "Solo se pueden enviar fotos o audios." };
  }

  try {
    const mensaje = await apiFetch<MensajeDelChat>(
      `/conversations/${conversationId}/media`,
      { ...LOGIN_CLIENTE, method: "POST", body: formData },
    );
    return { success: true, data: mensaje };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return errorDeChat(
      error,
      "Esta conversación está cerrada. Abre un chat nuevo desde el catálogo para seguir.",
      "enviarMediaAction",
    );
  }
}

const TIPOS_DE_COMPROBANTE = ["image/jpeg", "image/png", "image/webp"];

/** Sube la imagen del comprobante de pago (campo `file`, JPEG, PNG o WEBP). */
export async function subirComprobanteAction(
  conversationId: string,
  formData: FormData,
): Promise<ResultadoDeChat<MensajeDelChat>> {
  if (!UUID.test(conversationId)) {
    return { success: false, error: "No se pudo enviar. Recarga la página e inténtalo de nuevo." };
  }
  const archivo = formData.get("file");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { success: false, error: "Elige la imagen del comprobante antes de enviarla." };
  }
  if (!TIPOS_DE_COMPROBANTE.includes(archivo.type)) {
    return {
      success: false,
      error: "El comprobante debe ser una imagen JPEG, PNG o WEBP. Haz una captura y súbela.",
    };
  }

  try {
    const mensaje = await apiFetch<MensajeDelChat>(
      `/conversations/${conversationId}/receipt`,
      { ...LOGIN_CLIENTE, method: "POST", body: formData },
    );
    return { success: true, data: mensaje };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return errorDeChat(
      error,
      "Ahora no hay ningún comprobante pendiente. Si ya lo enviaste, espera la confirmación por este chat.",
      "subirComprobanteAction",
    );
  }
}
