import { apiFetch } from "@/lib/api-server";
import type { Conciliacion } from "@/lib/conciliacion";

/**
 * Conciliacion de dinero de un periodo (fechas `AAAA-MM-DD`, ambas inclusivas).
 * Solo la ve un administrador; para cualquier otro rol el backend responde 403.
 */
export async function getConciliacion(
  desde: string,
  hasta: string,
): Promise<Conciliacion> {
  return apiFetch<Conciliacion>(
    `/liquidations/conciliacion?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`,
    { authenticated: true },
  );
}
