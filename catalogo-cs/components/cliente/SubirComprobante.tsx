"use client";

import { nuevoId } from "@/lib/nuevo-id";
import { ChevronDown, Receipt } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { subirComprobanteAction } from "@/lib/actions/conversaciones";
import { comprimirCaptura } from "@/lib/comprimir-imagen";
import type { MensajeDelChat } from "@/lib/conversaciones";
import { esRedireccion } from "@/lib/es-redireccion";
import { botonPrimario, ErrorDeFormulario } from "./Campo";

const TIPOS = ["image/jpeg", "image/png", "image/webp"];

/**
 * Subida del comprobante de la transferencia.
 *
 * Solo se monta cuando `debeMostrarComprobante` dice que hay uno pendiente. Va
 * plegado en un `details` para no comerse la pantalla del chat en un telefono:
 * el aviso se ve siempre, el formulario al tocarlo.
 *
 * La imagen se comprime como captura (el texto pequeño de la transferencia
 * tiene que seguir legible) y lleva un `clientMessageId` fijo por archivo:
 * reintentar el mismo archivo tras un corte no crea un segundo comprobante.
 */
export default function SubirComprobante({
  conversationId,
  onEnviado,
}: {
  conversationId: string;
  onEnviado: (mensaje: MensajeDelChat) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<{ file: File; url: string; clientMessageId: string } | null>(null);
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();

  // La vista previa ocupa memoria hasta que se libera su URL.
  useEffect(() => {
    return () => {
      if (archivo) URL.revokeObjectURL(archivo.url);
    };
  }, [archivo]);

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) {
      setArchivo(null);
      return;
    }
    if (!TIPOS.includes(file.type)) {
      setArchivo(null);
      e.target.value = "";
      setError("El archivo debe ser una imagen JPEG, PNG o WEBP. Haz una captura de la transferencia y elígela.");
      return;
    }
    setArchivo({ file, url: URL.createObjectURL(file), clientMessageId: nuevoId() });
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!archivo) {
      setError("Elige la imagen del comprobante antes de enviarla.");
      inputRef.current?.focus();
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const comprimido = await comprimirCaptura(archivo.file);
        const datos = new FormData();
        datos.append("file", comprimido, archivo.file.name);
        datos.append("clientMessageId", archivo.clientMessageId);
        const resultado = await subirComprobanteAction(conversationId, datos);
        if (!resultado.success) {
          setError(resultado.error);
          return;
        }
        setArchivo(null);
        if (inputRef.current) inputRef.current.value = "";
        onEnviado(resultado.data);
      } catch (fallo) {
        if (esRedireccion(fallo)) throw fallo;
        setError("No se pudo enviar el comprobante. Revisa tu conexión y vuelve a intentarlo.");
      }
    });
  }

  return (
    <details className="group rounded-xl border border-[#C5A55A]/40 bg-zinc-950">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 [&::-webkit-details-marker]:hidden">
        <Receipt aria-hidden="true" className="h-4 w-4" />
        <span className="flex-1">Subir comprobante de pago</span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <form onSubmit={enviar} className="space-y-3 px-4 pb-4">
        <p id={`${id}-ayuda`} className="text-xs leading-relaxed text-zinc-400">
          Sube una captura de la transferencia donde se lean el importe, la
          fecha y la cuenta de destino. Formatos: JPEG, PNG o WEBP.
        </p>
        <label
          htmlFor={id}
          className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-700 px-4 text-xs font-medium text-zinc-300 transition-colors hover:border-[#C5A55A]/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#C5A55A]/60"
        >
          {archivo ? "Elegir otra imagen" : "Elegir imagen"}
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={`${id}-ayuda`}
            onChange={elegir}
            className="sr-only"
          />
        </label>
        {archivo ? (
          <figure className="overflow-hidden rounded-lg border border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), sin optimizador */}
            <img
              src={archivo.url}
              alt="Vista previa del comprobante elegido"
              className="max-h-56 w-full object-contain"
            />
            <figcaption className="truncate px-3 py-2 text-[11px] text-zinc-500">
              {archivo.file.name}
            </figcaption>
          </figure>
        ) : null}
        <ErrorDeFormulario mensaje={error} />
        <button
          type="submit"
          disabled={pendiente}
          aria-busy={pendiente}
          className={botonPrimario}
        >
          {pendiente ? "Enviando comprobante" : "Enviar comprobante"}
        </button>
      </form>
    </details>
  );
}
