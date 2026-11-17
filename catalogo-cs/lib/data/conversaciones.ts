import { apiFetch, ApiError } from "@/lib/api-server";
import type {
  PaginaDeMensajes,
  ResumenDeConversacion,
} from "@/lib/conversaciones";

/*
 * Lecturas del chat web del cliente, en el servidor.
 *
 * Todas mandan al login de cliente si la sesion no existe o caduco: con el
 * valor por defecto de `apiFetch` el cliente acabaria en el login del panel.
 */
const LOGIN_CLIENTE = { loginPath: "/ingresar" } as const;

/** Bandeja del cliente, la mas reciente primero (hasta 100). */
export function getConversaciones(): Promise<ResumenDeConversacion[]> {
  return apiFetch<ResumenDeConversacion[]>("/conversations", LOGIN_CLIENTE);
}

/**
 * Resumen de una conversacion del cliente (cabecera del chat y si espera
 * comprobante). `null` si no existe o no es suya: el backend responde 404 en
 * los dos casos para no revelar conversaciones ajenas. Cualquier otro fallo se
 * lanza, para que la pantalla lo distinga de "no existe".
 */
export async function getConversacion(
  conversationId: string,
): Promise<ResumenDeConversacion | null> {
  try {
    return await apiFetch<ResumenDeConversacion>(
      `/conversations/${encodeURIComponent(conversationId)}`,
      LOGIN_CLIENTE,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Una pagina de mensajes, del mas nuevo al mas antiguo. `cursor` es el id del
 * mensaje mas antiguo que ya se tiene.
 */
export function getMensajes(
  conversationId: string,
  { cursor, limit = 30 }: { cursor?: string | null; limit?: number } = {},
): Promise<PaginaDeMensajes> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<PaginaDeMensajes>(
    `/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    LOGIN_CLIENTE,
  );
}
