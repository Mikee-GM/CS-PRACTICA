"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { resincronizarServicio } from "@/lib/actions/conciliacion";
import { desenvolver } from "@/lib/resultado-accion";

/**
 * Vuelve a generar el registro de liquidacion de un servicio.
 *
 * Si el corte de esa semana ya esta confirmado el backend se niega y el motivo
 * llega aqui en espanol: no se reescribe lo que ya se pago.
 */
export default function BotonResincronizar({ servicioId }: { servicioId: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const regenerar = () =>
    iniciar(async () => {
      try {
        await desenvolver(resincronizarServicio(servicioId));
        toast.success("Registro de liquidacion regenerado");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "No se pudo regenerar el registro",
        );
      }
    });

  return (
    <button
      type="button"
      onClick={regenerar}
      disabled={pendiente}
      aria-busy={pendiente}
      className="min-h-11 rounded-lg border border-[#C5A55A]/50 px-3 text-xs font-semibold text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-50"
    >
      {pendiente ? "Regenerando" : "Regenerar registro"}
    </button>
  );
}
