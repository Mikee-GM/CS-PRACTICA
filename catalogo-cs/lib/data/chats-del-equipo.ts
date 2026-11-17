import { apiFetch } from "@/lib/api-server";
import type { ConversacionDelEquipo } from "@/lib/chats-del-equipo";
import type { EstadoConversacion } from "@/lib/conversaciones";

/*
 * Lecturas del chat web visto por el equipo, en el servidor. Sin sesion,
 * `apiFetch` manda al login del panel, que es su valor por defecto.
 */

/**
 * Bandeja del equipo: sin `estado`, todo menos las cerradas. El backend limita
 * a 200 y ordena por atencion y luego por el ultimo mensaje.
 */
export function getConversacionesDelEquipo(
  filtro: { estado?: EstadoConversacion | null; q?: string } = {},
): Promise<ConversacionDelEquipo[]> {
  const params = new URLSearchParams();
  if (filtro.estado) params.set("estado", filtro.estado);
  const q = filtro.q?.trim();
  if (q) params.set("q", q.slice(0, 100));
  const consulta = params.toString();
  return apiFetch<ConversacionDelEquipo[]>(
    `/staff/conversations${consulta ? `?${consulta}` : ""}`,
  );
}
