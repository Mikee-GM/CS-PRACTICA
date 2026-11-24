"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Camera, Image as IconoFoto, Mic, Send, Square, X } from "lucide-react";
import { useId, useRef } from "react";

import { formatearDuracion } from "@/lib/media-del-chat";
import type { useMediaDelChat } from "./useMediaDelChat";

type Controles = ReturnType<typeof useMediaDelChat>;

const boton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#C5A55A] transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40";

/**
 * Los tres botones del compositor: galeria, camara y microfono.
 *
 * Los dos primeros son `<input type=file>` ocultos: `capture` hace que en el
 * telefono la camara abra directo, y en un equipo de escritorio cae al selector
 * de archivos. Mientras se graba o hay una foto por confirmar se ocultan, para
 * que el compositor no tenga dos cosas a medias a la vez.
 */
export function BotonesDeMedia({
  controles,
  deshabilitado = false,
}: {
  controles: Controles;
  deshabilitado?: boolean;
}) {
  const id = useId();
  const galeria = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  if (controles.estado.fase !== "inactivo") return null;

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    controles.elegirFoto(e.target.files?.[0]);
    // Permite volver a elegir el mismo archivo despues de cancelar.
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={galeria}
        id={`${id}-galeria`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={alElegir}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={camara}
        id={`${id}-camara`}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={alElegir}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => galeria.current?.click()}
        disabled={deshabilitado}
        aria-label="Enviar una foto de la galería"
        className={boton}
      >
        <IconoFoto aria-hidden="true" className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => camara.current?.click()}
        disabled={deshabilitado}
        aria-label="Tomar una foto con la cámara"
        className={boton}
      >
        <Camera aria-hidden="true" className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => void controles.iniciarGrabacion()}
        disabled={deshabilitado}
        aria-label="Grabar una nota de voz"
        className={boton}
      >
        <Mic aria-hidden="true" className="h-5 w-5" />
      </button>
    </>
  );
}

/**
 * Lo que ocupa el sitio de la barra mientras hay algo a medias: la foto por
 * confirmar (con el texto del cuadro como pie) o la grabacion en curso.
 */
export function PanelDeMedia({
  controles,
  pie,
  onFotoEnviada,
  enviando = false,
}: {
  controles: Controles;
  /** Texto escrito en el compositor: acompaña a la foto. */
  pie?: string;
  /** Para que el compositor borre su texto si ya viajo como pie. */
  onFotoEnviada?: () => void;
  enviando?: boolean;
}) {
  const { estado } = controles;
  return (
    <div aria-live="polite">
      <AnimatePresence initial={false} mode="wait">
        {estado.fase === "foto" ? (
          <motion.div
            key="foto"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-3 rounded-xl border border-[#C5A55A]/30 bg-zinc-950 p-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), sin optimizador */}
            <img
              src={estado.vista}
              alt="Vista previa de la foto elegida"
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
            <p className="min-w-0 flex-1 text-xs leading-snug text-zinc-300">
              {pie?.trim()
                ? "Se enviará con tu mensaje como pie de foto."
                : "Foto lista. Puedes escribir un pie antes de enviarla."}
            </p>
            <button
              type="button"
              onClick={controles.cancelar}
              aria-label="Descartar la foto"
              className={boton}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
            <motion.button
              type="button"
              disabled={enviando}
              whileTap={{ scale: 0.9 }}
              onClick={async () => {
                if (await controles.enviarFoto(pie)) onFotoEnviada?.();
              }}
              aria-label="Enviar la foto"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#C5A55A] text-black transition-colors hover:bg-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40"
            >
              <Send aria-hidden="true" className="h-5 w-5" />
            </motion.button>
          </motion.div>
        ) : estado.fase === "pidiendo-permiso" || estado.fase === "grabando" ? (
          <motion.div
            key="grabando"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-3 rounded-xl border border-[#C5A55A]/30 bg-zinc-950 p-2"
          >
            <button
              type="button"
              onClick={controles.cancelar}
              aria-label="Cancelar la grabación"
              className={boton}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2" role="status">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none"
              />
              <span className="text-sm tabular-nums text-white">
                {estado.fase === "grabando"
                  ? formatearDuracion(controles.segundos * 1000)
                  : "Esperando el permiso del micrófono"}
              </span>
              {estado.fase === "grabando" ? (
                <span className="sr-only">Grabando nota de voz</span>
              ) : null}
            </div>
            <motion.button
              type="button"
              disabled={estado.fase !== "grabando"}
              whileTap={{ scale: 0.9 }}
              onClick={controles.terminarGrabacion}
              aria-label="Terminar y enviar la nota de voz"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#C5A55A] text-black transition-colors hover:bg-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40"
            >
              <Square aria-hidden="true" className="h-4 w-4 fill-current" />
            </motion.button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {controles.error ? (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {controles.error}
        </p>
      ) : null}
    </div>
  );
}
