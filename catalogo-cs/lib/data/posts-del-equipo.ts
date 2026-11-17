import { apiFetch } from "@/lib/api-server";
import {
  ESTADO_POR_DEFECTO,
  LIMITE_DE_LA_COLA,
  type ColaDePosts,
  type EstadoFiltrable,
} from "@/lib/posts-del-equipo";

/*
 * Lecturas de la cola de publicaciones del equipo, en el servidor. Sin sesion,
 * `apiFetch` manda al login del panel, que es su valor por defecto.
 */

/**
 * Primera pagina de la cola. Pendientes del mas antiguo al mas nuevo (el que
 * mas espera, primero); los demas estados, del mas reciente al mas antiguo.
 */
export function getColaDePosts(
  filtro: { estado?: EstadoFiltrable; employeeId?: string | null } = {},
): Promise<ColaDePosts> {
  const params = new URLSearchParams({
    estado: filtro.estado ?? ESTADO_POR_DEFECTO,
    limit: String(LIMITE_DE_LA_COLA),
  });
  if (filtro.employeeId) params.set("employeeId", filtro.employeeId);
  return apiFetch<ColaDePosts>(`/staff/posts?${params.toString()}`);
}
