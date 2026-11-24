"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Camera, Image as IconoFoto, MapPin, Mic, Plus, Send, Square, X } from "lucide-react";
import { useRef } from "react";

import { formatearDuracion } from "@/lib/media-del-chat";
import type { useMediaDelChat } from "./useMediaDelChat";

type Controles = ReturnType<typeof useMediaDelChat>;

const boton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#C5A55A] transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40";

const botonChico =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#C5A55A] transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40 sm:h-11 sm:w-11";

/**
 * Los dos `<input type=file>` ocultos y sus botones: galeria y camara.
 *
 * `capture` hace que en el telefono la camara abra directo, y en un equipo de
 * escritorio cae al selector de archivos. Los inputs siguen en el DOM aunque el
 * menu este cerrado: si se desmontaran, el navegador perderia el archivo elegido.
 */
function useEntradasDeFoto(controles: Controles) {
  const galeria = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    controles.elegirFoto(e.target.files?.[0]);
    // Permite volver a elegir el mismo archivo despues de cancelar.
    e.target.value = "";
  };
  const entradas = (
    <>
      <input
        ref={galeria}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={alElegir}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={camara}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={alElegir}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
  return {
    entradas,
    abrirGaleria: () => galeria.current?.click(),
    abrirCamara: () => camara.current?.click(),
  };
}

export function BotonMicrofono({
  controles,
  deshabilitado,
}: {
  controles: Controles;
  deshabilitado: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => void controles.iniciarGrabacion()}
      disabled={deshabilitado}
      aria-label="Grabar una nota de voz"
      className={botonChico}
    >
      <Mic aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

/**
 * Galeria, camara y microfono en fila, para el panel del equipo. Mientras se
 * graba o hay una foto por confirmar se ocultan, para que el compositor no tenga
 * dos cosas a medias a la vez.
 */
export function BotonesDeMedia({
  controles,
  deshabilitado = false,
}: {
  controles: Controles;
  deshabilitado?: boolean;
}) {
  const { entradas, abrirGaleria, abrirCamara } = useEntradasDeFoto(controles);
  const libre = controles.estado.fase === "inactivo";
  return (
    <>
      {entradas}
      {libre ? (
        <>
          <button
            type="button"
            onClick={abrirGaleria}
            disabled={deshabilitado}
            aria-label="Enviar una foto de la galería"
            className={botonChico}
          >
            <IconoFoto aria-hidden="true" className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={abrirCamara}
            disabled={deshabilitado}
            aria-label="Tomar una foto con la cámara"
            className={botonChico}
          >
            <Camera aria-hidden="true" className="h-5 w-5" />
          </button>
          <BotonMicrofono controles={controles} deshabilitado={deshabilitado} />
        </>
      ) : null}
    </>
  );
}

/**
 * Menu "+" del chat del cliente: ubicacion, galeria y camara en una fila de tres
 * etiquetadas, sobre la barra. Deja la barra con lo esencial (boton, texto y
 * microfono o enviar), que es lo que cabe en un telefono estrecho.
 */
export function MenuDeAdjuntos({
  controles,
  abierto,
  onCerrar,
  onUbicacion,
  ubicacionOcupada = false,
}: {
  controles: Controles;
  abierto: boolean;
  onCerrar: () => void;
  onUbicacion: () => void;
  ubicacionOcupada?: boolean;
}) {
  const { entradas, abrirGaleria, abrirCamara } = useEntradasDeFoto(controles);
  const visible = abierto && controles.estado.fase === "inactivo";
  const accion =
    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-2 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[#C5A55A]/50 hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40";
  return (
    <div>
      {entradas}
      <div hidden={!visible} className="grid grid-cols-3 gap-2" id="menu-de-adjuntos">
        <button
          type="button"
          disabled={ubicacionOcupada}
          onClick={() => {
            onCerrar();
            onUbicacion();
          }}
          className={accion}
        >
          <MapPin aria-hidden="true" className="h-5 w-5 text-[#C5A55A]" />
          Ubicación
        </button>
        <button
          type="button"
          onClick={() => {
            onCerrar();
            abrirGaleria();
          }}
          className={accion}
        >
          <IconoFoto aria-hidden="true" className="h-5 w-5 text-[#C5A55A]" />
          Galería
        </button>
        <button
          type="button"
          onClick={() => {
            onCerrar();
            abrirCamara();
          }}
          className={accion}
        >
          <Camera aria-hidden="true" className="h-5 w-5 text-[#C5A55A]" />
          Cámara
        </button>
      </div>
    </div>
  );
}

/** El boton "+" que abre y cierra el menu de adjuntos. */
export function BotonMas({
  controles,
  abierto,
  onAlternar,
}: {
  controles: Controles;
  abierto: boolean;
  onAlternar: () => void;
}) {
  if (controles.estado.fase !== "inactivo") return null;
  return (
    <>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        aria-controls="menu-de-adjuntos"
        aria-label={abierto ? "Cerrar los adjuntos" : "Adjuntar ubicación, foto o cámara"}
        className={botonChico}
      >
        <Plus
          aria-hidden="true"
          className={`h-6 w-6 transition-transform motion-reduce:transition-none ${abierto ? "rotate-45" : ""}`}
        />
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
