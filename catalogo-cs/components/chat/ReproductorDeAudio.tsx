"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatearDuracion } from "@/lib/media-del-chat";

/**
 * Nota de voz dentro de una burbuja.
 *
 * Un `<audio>` oculto y un control propio: el nativo no respeta la paleta y es
 * demasiado ancho para una burbuja en el telefono. La duracion se toma del
 * mensaje cuando viene (`durationMs`), porque una grabacion WebM de un
 * navegador no trae su duracion en el archivo y `audio.duration` da `Infinity`.
 *
 * Solo suena uno a la vez: al empezar uno se detienen los demas de la pagina.
 */
export default function ReproductorDeAudio({
  url,
  durationMs,
  etiqueta = "nota de voz",
}: {
  url: string;
  durationMs?: number;
  etiqueta?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [sonando, setSonando] = useState(false);
  const [avance, setAvance] = useState(0);
  const [error, setError] = useState(false);
  const [duracionDelArchivo, setDuracionDelArchivo] = useState<number | null>(null);

  const total = durationMs ?? (duracionDelArchivo ? duracionDelArchivo * 1000 : 0);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const alEmpezar = () => {
      document.querySelectorAll("audio").forEach((otro) => {
        if (otro !== el) otro.pause();
      });
      setSonando(true);
    };
    const alParar = () => setSonando(false);
    const alAvanzar = () => {
      const duracion = total || (Number.isFinite(el.duration) ? el.duration * 1000 : 0);
      setAvance(duracion ? Math.min(1, (el.currentTime * 1000) / duracion) : 0);
    };
    const alTerminar = () => {
      setSonando(false);
      setAvance(0);
      el.currentTime = 0;
    };
    const alCargar = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuracionDelArchivo(el.duration);
    };
    el.addEventListener("play", alEmpezar);
    el.addEventListener("pause", alParar);
    el.addEventListener("timeupdate", alAvanzar);
    el.addEventListener("ended", alTerminar);
    el.addEventListener("loadedmetadata", alCargar);
    return () => {
      el.removeEventListener("play", alEmpezar);
      el.removeEventListener("pause", alParar);
      el.removeEventListener("timeupdate", alAvanzar);
      el.removeEventListener("ended", alTerminar);
      el.removeEventListener("loadedmetadata", alCargar);
    };
  }, [total]);

  function alternar() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      setError(false);
      void el.play().catch(() => setError(true));
    } else {
      el.pause();
    }
  }

  return (
    <div className="flex min-w-[11rem] items-center gap-3">
      <button
        type="button"
        onClick={alternar}
        aria-label={sonando ? `Pausar ${etiqueta}` : `Reproducir ${etiqueta}`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#C5A55A]/60 text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
      >
        {sonando ? (
          <Pause aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Play aria-hidden="true" className="ml-0.5 h-4 w-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-zinc-700" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[#C5A55A]"
            style={{ width: `${Math.round(avance * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] tabular-nums text-zinc-400">
          {error ? "No se pudo reproducir" : formatearDuracion(total)}
        </p>
      </div>
      <audio ref={audio} src={url} preload="metadata" />
    </div>
  );
}
