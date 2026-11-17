"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Vuelve a pedir al servidor la pagina actual, para las lecturas que fallaron
 * por la red. Sin recargar el documento: la barra y el resto no parpadean.
 */
export default function BotonReintentar({ etiqueta = "Reintentar" }: { etiqueta?: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      // `aria-disabled` y no `disabled`: un boton deshabilitado con el foco
      // encima lo suelta al documento.
      aria-disabled={pendiente}
      aria-busy={pendiente}
      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#C5A55A]/60 px-5 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A] aria-disabled:opacity-50"
    >
      {pendiente ? "Cargando" : etiqueta}
    </button>
  );
}
