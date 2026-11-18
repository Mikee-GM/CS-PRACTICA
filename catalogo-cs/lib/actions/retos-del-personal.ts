"use server";

import { apiFetch } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import type { RetoDelPersonal } from "@/lib/retos-del-personal";

/**
 * Retos de la persona en sesion. El backend resuelve quien es por el usuario y
 * solo acepta empleada o chofer; ante cualquier fallo devuelve una lista vacia
 * para que la seccion muestre su estado vacio en lugar de romper el portal.
 */
export async function obtenerMisRetos(): Promise<RetoDelPersonal[]> {
  try {
    return await apiFetch<RetoDelPersonal[]>("/challenges/mine");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("retos del personal:", error);
    return [];
  }
}
