import { apiFetch } from "@/lib/api-server";
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
