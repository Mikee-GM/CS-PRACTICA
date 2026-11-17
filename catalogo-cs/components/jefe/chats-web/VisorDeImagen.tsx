"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * Comprobante o foto a pantalla completa.
 *
 * `<dialog>` nativo: se cierra con Esc, con el gesto atras del telefono y, donde
 * hay `closedby="any"`, tocando fuera. En Safari, sin `closedby`, quedan Esc,
 * el gesto y el boton visible de cerrar, que siempre esta.
 */
export default function VisorDeImagen({
  imagen,
  onCerrar,
}: {
  imagen: { url: string; titulo: string } | null;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (imagen && !dialogo.open) dialogo.showModal();
    if (!imagen && dialogo.open) dialogo.close();
  }, [imagen]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={tituloId}
      onClose={() => {
        if (imagen) onCerrar();
      }}
      // React aun no tipa `closedby`; el navegador que no lo conoce lo ignora.
      {...({ closedby: "any" } as Record<string, string>)}
      className="m-auto max-h-[100dvh] w-full max-w-3xl overscroll-contain bg-transparent p-0 backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/90"
    >
      {imagen ? (
        <div className="flex flex-col gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <h2 id={tituloId} className="font-heading text-xl text-[#E8D5A3]">
              {imagen.titulo}
            </h2>
            <button
              type="button"
              onClick={onCerrar}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-black text-zinc-300 hover:border-[#C5A55A] hover:text-[#C5A55A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
            >
              <X aria-hidden="true" size={18} />
              <span className="sr-only">Cerrar</span>
            </button>
          </div>
          {/* La URL la firma el backend al vuelo: ver la nota de `Burbuja`. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagen.url}
            alt={imagen.titulo}
            className="max-h-[78dvh] w-full rounded-xl border border-zinc-800 bg-black object-contain"
          />
          <a
            href={imagen.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center self-start text-xs font-semibold text-[#C5A55A] underline-offset-4 hover:underline"
          >
            Abrir en una pestaña nueva
          </a>
        </div>
      ) : null}
    </dialog>
  );
}
