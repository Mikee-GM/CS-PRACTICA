"use client";

import { motion } from "framer-motion";
import { SendHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  BotonMas,
  BotonMicrofono,
  MenuDeAdjuntos,
  PanelDeMedia,
} from "@/components/chat/ControlesDeMedia";
import { useMediaDelChat } from "@/components/chat/useMediaDelChat";
import type { UbicacionDelMensaje } from "@/lib/conversaciones";
import type { MediaParaEnviar } from "@/lib/media-del-chat";
import { ErrorDeFormulario } from "./Campo";

const MAXIMO = 2000;

const botonIcono =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40";

const botonTexto =
  "inline-flex min-h-11 items-center rounded-lg px-4 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60";

type EstadoUbicacion =
  | { fase: "inactiva" }
  | { fase: "confirmando" }
  | { fase: "buscando" }
  | { fase: "error"; mensaje: string };

/**
 * Por que fallo la geolocalizacion, dicho de forma que se sepa que hacer.
 * Siempre queda la alternativa de escribir la direccion.
 */
function mensajeDeGeolocalizacion(codigo: number | "no-disponible"): string {
  const alternativa =
    "Puedes escribir tu dirección en el mensaje: calle, número, colonia y una referencia.";
  if (codigo === 1) {
    return `No diste permiso para usar tu ubicación. Actívalo en los ajustes del navegador para este sitio, o ${alternativa.charAt(0).toLowerCase()}${alternativa.slice(1)}`;
  }
  if (codigo === "no-disponible") {
    return `Este navegador no puede compartir tu ubicación. ${alternativa}`;
  }
  // 2: posicion no disponible, 3: tiempo agotado.
  return `No pudimos obtener tu ubicación. Revisa que el GPS esté activo y vuelve a intentarlo. ${alternativa}`;
}

/**
 * Barra de escritura del chat.
 *
 * Vive fuera de la zona con scroll, al pie de una columna que mide la altura
 * visible (`h-dvh`): con el teclado abierto el visor se encoge y la barra sube
 * con el, asi que el boton de enviar nunca queda tapado. El relleno inferior
 * respeta el area segura del indicador de inicio.
 *
 * Enter envia solo con puntero fino (teclado fisico); en el telefono Enter
 * hace salto de linea y se envia con el boton, como en cualquier mensajeria.
 */
export default function BarraEscritura({
  nombreModelo,
  cerrada,
  error,
  onEnviar,
  onEnviarUbicacion,
  onEnviarMedia,
  textareaRef,
}: {
  nombreModelo: string;
  cerrada: boolean;
  error: string;
  onEnviar: (texto: string) => void;
  onEnviarUbicacion: (ubicacion: UbicacionDelMensaje) => void;
  onEnviarMedia: (media: MediaParaEnviar, pie?: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [texto, setTexto] = useState("");
  const [ubicacion, setUbicacion] = useState<EstadoUbicacion>({ fase: "inactiva" });
  const media = useMediaDelChat({ onEnviar: onEnviarMedia });
  const ocupada = media.estado.fase !== "inactivo";
  const [menuAbierto, setMenuAbierto] = useState(false);
  const hayTexto = texto.trim().length > 0;

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio || cerrada) return;
    onEnviar(limpio);
    setTexto("");
  }

  function alPulsarTecla(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    e.preventDefault();
    // Enter confirma la palabra en un IME (japones, chino, coreano); Safari
    // entrega ese Enter con `isComposing` ya en falso pero con keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    formRef.current?.requestSubmit();
  }

  function pedirUbicacion() {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setUbicacion({ fase: "error", mensaje: mensajeDeGeolocalizacion("no-disponible") });
      return;
    }
    setUbicacion({ fase: "buscando" });
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        setUbicacion({ fase: "inactiva" });
        onEnviarUbicacion({
          lat: posicion.coords.latitude,
          lng: posicion.coords.longitude,
        });
      },
      (fallo) => {
        setUbicacion({ fase: "error", mensaje: mensajeDeGeolocalizacion(fallo.code) });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  function escribirDireccion() {
    setUbicacion({ fase: "inactiva" });
    textareaRef.current?.focus();
  }

  if (cerrada) {
    return (
      <div className="shrink-0 border-t border-zinc-800/80 bg-[#050505] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <p className="mx-auto max-w-2xl text-center text-xs text-zinc-400">
          Esta conversación está cerrada y ya no admite mensajes. Para volver a
          escribir, abre un chat nuevo desde el catálogo.
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-800/80 bg-[#050505] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-2">
      <div className="mx-auto w-full max-w-2xl space-y-2">
        {ubicacion.fase === "confirmando" ? (
          // El permiso del navegador llega despues de explicar para que se usa,
          // nunca de golpe al tocar un icono.
          <div className="rounded-xl border border-[#C5A55A]/30 bg-zinc-950 p-3">
            <p className="text-xs leading-relaxed text-zinc-300">
              Compartiremos tu ubicación actual una sola vez para confirmar la
              cobertura y el punto de encuentro. Tu navegador te pedirá permiso.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={pedirUbicacion}
                className={`${botonTexto} bg-[#C5A55A] text-black hover:bg-[#D4AF37]`}
              >
                Compartir ubicación
              </button>
              <button
                type="button"
                onClick={() => setUbicacion({ fase: "inactiva" })}
                className={`${botonTexto} text-zinc-400 hover:text-white`}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {ubicacion.fase === "error" ? (
          <div className="space-y-2">
            <ErrorDeFormulario mensaje={ubicacion.mensaje} />
            <button
              type="button"
              onClick={escribirDireccion}
              className={`${botonTexto} border border-[#C5A55A]/50 text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black`}
            >
              Escribir mi dirección
            </button>
          </div>
        ) : null}

        <ErrorDeFormulario mensaje={error} />

        <PanelDeMedia
          controles={media}
          pie={texto}
          onFotoEnviada={() => setTexto("")}
        />

        <MenuDeAdjuntos
          controles={media}
          abierto={menuAbierto}
          onCerrar={() => setMenuAbierto(false)}
          onUbicacion={() => setUbicacion({ fase: "confirmando" })}
          ubicacionOcupada={ubicacion.fase === "buscando"}
        />

        <form ref={formRef} onSubmit={enviar} className="flex items-end gap-1.5">
          <BotonMas
            controles={media}
            abierto={menuAbierto}
            onAlternar={() => setMenuAbierto((v) => !v)}
          />
          <label htmlFor={id} className="sr-only">
            Mensaje para {nombreModelo}
          </label>
          <textarea
            id={id}
            ref={textareaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alPulsarTecla}
            rows={1}
            maxLength={MAXIMO}
            placeholder="Escribe un mensaje"
            autoComplete="off"
            enterKeyHint="enter"
            className="field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-zinc-800 bg-black/60 px-4 py-2.5 text-base leading-snug text-white placeholder:text-zinc-600 focus:border-[#C5A55A]/60 focus:outline-none focus:ring-4 focus:ring-[#C5A55A]/10 sm:text-sm"
          />
          {hayTexto || ocupada ? (
            <motion.button
              type="submit"
              disabled={!hayTexto || ocupada}
              aria-label="Enviar mensaje"
              whileTap={{ scale: 0.9 }}
              className={`${botonIcono} bg-[#C5A55A] text-black hover:bg-[#D4AF37]`}
            >
              <SendHorizontal aria-hidden="true" className="h-5 w-5" />
            </motion.button>
          ) : (
            // Sin texto el sitio de enviar es del microfono, como en cualquier mensajeria.
            media.estado.fase === "inactivo" ? (
              <BotonMicrofono controles={media} deshabilitado={false} />
            ) : null
          )}
        </form>
      </div>
    </div>
  );
}
