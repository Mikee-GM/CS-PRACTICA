"use server";

import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import type { BeneficioDeInstalacion } from "@/lib/beneficios-del-cliente";

export type ResultadoDeBeneficio =
  | { success: true; data: BeneficioDeInstalacion }
  | { success: false; error: string };

/**
 * Activa el descuento por instalar la app. Se llama al abrir la app instalada con
 * sesion; repetirlo no cambia nada. Devuelve el resultado en vez de lanzar: una
 * Server Action oculta el mensaje de un error lanzado.
 */
export async function reclamarDescuentoDeInstalacionAction(): Promise<ResultadoDeBeneficio> {
  try {
    const data = await apiFetch<BeneficioDeInstalacion>("/client-benefits/app-install", {
      method: "POST",
      loginPath: "/ingresar",
    });
    return { success: true, data };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError && error.status === 429) {
      return { success: false, error: "Espera un momento y vuelve a intentarlo." };
    }
    return {
      success: false,
      error: "No pudimos activar el descuento. Lo intentaremos al abrir la app de nuevo.",
    };
  }
}
