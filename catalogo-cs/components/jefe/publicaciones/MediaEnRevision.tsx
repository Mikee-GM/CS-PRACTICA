"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Maximize2 } from "lucide-react";

import {
  avisoDeDuracion,
  duracionLegible,
  fraccionReproducida,
  nombreDeMedia,
  videoVisto,
} from "@/lib/posts-del-equipo";
import type { MediaDelPost } from "@/lib/posts";

/** Fraccion de la foto que tiene que estar a la vista para darla por vista. */
const FOTO_VISIBLE_MINIMA = 0.6;

/**
 * Una media de la publicacion en revision, a tamaño util y con su estado de
 * revision en texto ("Vista", "Visto 40 %"), no solo con un icono.
 *
 * Las fotos cuentan como revisadas cuando se cargaron y estuvieron a la vista
 * o se abrieron en grande. Los videos, cuando `video.played` cubre casi toda
 * la duracion: arrastrar la barra hasta el final no basta. Nunca arrancan
 * solos; `preload="metadata"` baja solo la cabecera para medir la duracion
 * real, que es la unica comprobacion del tope de 30 s (la declarada la manda
 * el navegador de quien subio el video y nadie la verifica).
 */
export default function MediaEnRevision({
  media,
  indice,
  total,
  modelo,
  revisada,
  domId,
  onRevisada,
  onAmpliar,
}: {
  media: MediaDelPost;
  indice: number;
  total: number;
  modelo: string;
  revisada: boolean;
  /** Id del contenedor, para llevar el foco a la media que falta revisar. */
  domId: string;
  onRevisada: () => void;
  onAmpliar: (imagen: { url: string; titulo: string }) => void;
}) {
  const nombre = nombreDeMedia(media, indice);
  const titulo = `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} de ${total} de ${modelo}`;

  return (
    <figure
      id={domId}
      tabIndex={-1}
      className="overflow-hidden rounded-xl border border-zinc-800 bg-[#050505] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
    >
      {media.kind === "video" ? (
        <VideoEnRevision
          media={media}
          titulo={titulo}
          revisada={revisada}
          onRevisada={onRevisada}
        />
      ) : (
        <FotoEnRevision
          media={media}
          titulo={titulo}
          revisada={revisada}
          onRevisada={onRevisada}
          onAmpliar={onAmpliar}
        />
      )}
    </figure>
  );
}

function EstadoDeRevision({ revisada, texto }: { revisada: boolean; texto: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
        revisada ? "text-[#E8D5A3]" : "text-zinc-500"
      }`}
    >
      {revisada ? (
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <Circle aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {texto}
    </span>
  );
}

function FotoEnRevision({
  media,
  titulo,
  revisada,
  onRevisada,
  onAmpliar,
}: {
  media: MediaDelPost;
  titulo: string;
  revisada: boolean;
  onRevisada: () => void;
  onAmpliar: (imagen: { url: string; titulo: string }) => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [cargada, setCargada] = useState(false);
  const [fallo, setFallo] = useState(false);
  const avisar = useRef(onRevisada);
  avisar.current = onRevisada;

  // La foto se da por vista cuando, ya cargada, paso por la pantalla.
  useEffect(() => {
    const imagen = ref.current;
    if (!imagen || !cargada || revisada) return;
    if (typeof IntersectionObserver === "undefined") {
      avisar.current();
      return;
    }
    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada && entrada.intersectionRatio >= FOTO_VISIBLE_MINIMA) {
          avisar.current();
          observador.disconnect();
        }
      },
      { threshold: [FOTO_VISIBLE_MINIMA] },
    );
    observador.observe(imagen);
    return () => observador.disconnect();
  }, [cargada, revisada]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onAmpliar({ url: media.url, titulo });
          if (cargada) onRevisada();
        }}
        className="group relative block w-full bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/60"
      >
        {/* La URL es publica de R2 y el dominio puede no estar en `next.config`. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={ref}
          src={media.url}
          alt={titulo}
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          decoding="async"
          onLoad={() => setCargada(true)}
          onError={() => setFallo(true)}
          className="mx-auto h-auto max-h-[70dvh] w-full object-contain"
        />
        <span className="absolute right-2 top-2 flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 bg-black/80 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-200 group-hover:border-[#C5A55A] group-hover:text-[#C5A55A]">
          <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
          Ampliar
        </span>
      </button>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs text-zinc-400">{titulo}</span>
        {fallo ? (
          <span role="alert" className="text-[11px] font-semibold text-red-400">
            No se pudo cargar. Recarga la página; si sigue igual, recházala.
          </span>
        ) : (
          <EstadoDeRevision revisada={revisada} texto={revisada ? "Vista" : "Sin ver"} />
        )}
      </figcaption>
    </>
  );
}

function VideoEnRevision({
  media,
  titulo,
  revisada,
  onRevisada,
}: {
  media: MediaDelPost;
  titulo: string;
  revisada: boolean;
  onRevisada: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [vista, setVista] = useState(0);
  const [duracionReal, setDuracionReal] = useState<number | null>(null);
  const [fallo, setFallo] = useState(false);

  function medir() {
    const video = ref.current;
    if (!video) return;
    const tramos: Array<[number, number]> = [];
    for (let i = 0; i < video.played.length; i++) {
      tramos.push([video.played.start(i), video.played.end(i)]);
    }
    const fraccion = fraccionReproducida(tramos, video.duration);
    setVista(fraccion);
    if (!revisada && videoVisto(fraccion)) onRevisada();
  }

  const declarada = duracionLegible(media.durationMs);
  const real = duracionReal !== null ? duracionLegible(duracionReal * 1000) : null;
  const aviso = avisoDeDuracion(media.durationMs, duracionReal);
  const porcentaje = Math.round(vista * 100);

  return (
    <>
      <video
        ref={ref}
        src={media.url}
        poster={media.posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        // Enteros: sin ellos el video sin cargar mide 300x150 y la columna salta.
        width={media.width ?? 720}
        height={media.height ?? 1280}
        aria-label={titulo}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuracionReal(d);
        }}
        onTimeUpdate={medir}
        onPause={medir}
        onEnded={medir}
        onError={() => setFallo(true)}
        className="mx-auto block h-auto max-h-[70dvh] w-full bg-black object-contain"
      >
        Tu navegador no puede reproducir este video.
      </video>
      <figcaption className="space-y-1 px-3 py-2">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">
            {titulo}
            {declarada ? <span className="text-zinc-500"> · declarado {declarada}</span> : null}
            {real && real !== declarada ? <span className="text-zinc-500"> · real {real}</span> : null}
          </span>
          {fallo ? null : (
            <EstadoDeRevision
              revisada={revisada}
              texto={revisada ? "Visto completo" : `Visto ${porcentaje} %`}
            />
          )}
        </span>
        {fallo ? (
          <span role="alert" className="block text-[11px] font-semibold text-red-400">
            No se pudo reproducir. Recarga la página; si sigue igual, recházala.
          </span>
        ) : null}
        {aviso ? (
          <span className="block text-[11px] font-semibold text-[#D4AF37]">{aviso}</span>
        ) : null}
      </figcaption>
    </>
  );
}
