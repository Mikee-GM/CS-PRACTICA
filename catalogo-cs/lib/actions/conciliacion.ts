"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api-server";
import { ejecutarAccion } from "@/lib/ejecutar-accion";
import type { ResultadoAccion } from "@/lib/resultado-accion";

/**
 * Vuelve a generar el registro de liquidacion de un servicio terminado.
 *
 * El backend se niega si la semana de la empleada ya tiene el corte confirmado:
 * cambiar el pasado despues de pagar es la discrepancia que se quiere evitar. Ese
 * motivo llega aqui en espanol y es lo que ve quien pulsa el boton.
 */
export async function resincronizarServicio(
  servicioId: string,
): Promise<ResultadoAccion<void>> {
  return ejecutarAccion(async () => {
    await apiFetch<void>(
      `/liquidations/conciliacion/servicios/${servicioId}/resincronizar`,
      { method: "POST", authenticated: true },
    );
    revalidatePath("/admin/dashboard");
  }, "No se pudo regenerar el registro de liquidacion.");
}
