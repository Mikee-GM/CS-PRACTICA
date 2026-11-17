"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  etiquetaDeDiapositiva,
  proporcionDelCarrusel,
  type MediaDelPost,
} from "@/lib/posts";
import VideoPost from "./VideoPost";

/** Tamaño supuesto de una media sin dimensiones: 4:5, el caso mas comun. */
const ANCHO_POR_DEFECTO = 1080;
const ALTO_POR_DEFECTO = 1350;

/** Espera tras el ultimo `scroll` donde no existe `scrollend`. */
const ESPERA_SIN_SCROLLEND_MS = 120;

/** La tarjeta mide como mucho `max-w-xl` (36rem); en movil, todo el ancho. */
const SIZES = "(min-width: 36rem) 36rem, 100vw";

function movimientoReducido(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fotos y videos de una publicacion.
 *
 * La base es el scroll horizontal nativo con snap local a la pista: se puede
 * deslizar con el dedo, con el trackpad o con el teclado sin que el script
 * haga nada, y la rueda vertical del raton sigue moviendo la pagina. Encima van
 * los botones (anterior, siguiente y uno por diapositiva) y el anuncio de la
 * diapositiva actual cuando el desplazamiento termina.
 *
 * La navegacion es finita, sin vuelta del final al principio: en un feed se
 * hojean pocas fotos por publicacion y el punto activo ya dice en cual se esta.
 * Dar la vuelta exige reordenar diapositivas con `order` y compensar el scroll,
 * y eso no se ha podido probar en un navegador real.
 *
 * Una sola media no lleva nada de esto: se pinta tal cual.
 */
export default function CarruselMedia({
  media,
  nombreModelo,
  prioridad,
}: {
  /** Ya ordenada por `position`. */
  media: MediaDelPost[];
  nombreModelo: string;
  /** Primera publicacion de la pantalla: su primera imagen es candidata a LCP. */
  prioridad: boolean;
}) {
  const proporcion = proporcionDelCarrusel(media);
  const total = media.length;

  if (total === 1) {
    return (
      <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: proporcion }}>
        <Diapositiva
          media={media[0]}
          indice={0}
          total={1}
          nombreModelo={nombreModelo}
          prioridad={prioridad}
        />
      </div>
    );
  }
  return (
    <Carrusel
      media={media}
      nombreModelo={nombreModelo}
      prioridad={prioridad}
      proporcion={proporcion}
    />
  );
}

function Diapositiva({
  media,
  indice,
  total,
  nombreModelo,
  prioridad,
}: {
  media: MediaDelPost;
  indice: number;
  total: number;
  nombreModelo: string;
  prioridad: boolean;
}) {
  const ancho = media.width ?? ANCHO_POR_DEFECTO;
  const alto = media.height ?? ALTO_POR_DEFECTO;
  const visibleAlCargar = prioridad && indice === 0;

  if (media.kind === "video") {
    return (
      <VideoPost
        url={media.url}
        posterUrl={media.posterUrl}
        ancho={ancho}
        alto={alto}
        etiqueta={`${etiquetaDeDiapositiva("video", indice, total)} de ${nombreModelo}`}
        diferido={!visibleAlCargar}
      />
    );
  }

  return (
    <Image
      src={media.url}
      // El backend aun no guarda texto alternativo por foto.
      alt={`Publicación de ${nombreModelo}`}
      fill
      sizes={SIZES}
      className="object-contain"
      {...(visibleAlCargar
        ? { priority: true }
        : indice > 0
          ? // Ocultas dentro de la pista: no compiten con lo que si se ve.
            { loading: "lazy" as const, fetchPriority: "low" as const }
          : { loading: "lazy" as const })}
    />
  );
}

function Carrusel({
  media,
  nombreModelo,
  prioridad,
  proporcion,
}: {
  media: MediaDelPost[];
  nombreModelo: string;
  prioridad: boolean;
  proporcion: number;
}) {
  const total = media.length;
  const pistaRef = useRef<HTMLDivElement>(null);
  const anteriorRef = useRef<HTMLButtonElement>(null);
  const siguienteRef = useRef<HTMLButtonElement>(null);

  // `actual` sigue al dedo (puntos); `asentada` solo cambia al terminar el
  // desplazamiento (botones y anuncio).
  const [actual, setActual] = useState(0);
  const [asentada, setAsentada] = useState(0);
  const [anuncio, setAnuncio] = useState("");

  // Destino de un clic o tecla aun en camino: los clics rapidos se suman a el.
  const objetivo = useRef<number | null>(null);
  const anunciada = useRef(0);
  const cuadro = useRef<number | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const diapositivas = useCallback(
    () => Array.from(pistaRef.current?.children ?? []) as HTMLElement[],
    [],
  );

  /** La diapositiva mas cercana a la posicion actual de la pista. */
  const masCercana = useCallback((): number => {
    const pista = pistaRef.current;
    if (!pista) return 0;
    let mejor = 0;
    let distancia = Infinity;
    diapositivas().forEach((d, i) => {
      const delta = Math.abs(d.offsetLeft - pista.scrollLeft);
      if (delta < distancia) {
        distancia = delta;
        mejor = i;
      }
    });
    return mejor;
  }, [diapositivas]);

  const asentar = useCallback(() => {
    const i = masCercana();
    objetivo.current = null;
    setActual(i);
    setAsentada(i);
    // Solo se anuncia un cambio real: ni la carga ni volver a la misma.
    if (i !== anunciada.current) {
      anunciada.current = i;
      setAnuncio(etiquetaDeDiapositiva(media[i].kind, i, total));
    }
  }, [masCercana, media, total]);

  const irA = useCallback(
    (indice: number) => {
      const pista = pistaRef.current;
      const destino = diapositivas()[indice];
      if (!pista || !destino) return;
      objetivo.current = indice;
      setActual(indice);
      if (Math.abs(pista.scrollLeft - destino.offsetLeft) < 1) {
        // Ya estaba ahi: no habra `scrollend` que lo cierre.
        asentar();
        return;
      }
      pista.scrollTo({
        left: destino.offsetLeft,
        behavior: movimientoReducido() ? "auto" : "smooth",
      });
    },
    [asentar, diapositivas],
  );

  const mover = useCallback(
    (paso: number) => {
      const desde = objetivo.current ?? masCercana();
      const hacia = Math.min(total - 1, Math.max(0, desde + paso));
      if (hacia !== desde) irA(hacia);
    },
    [irA, masCercana, total],
  );

  useEffect(() => {
    const pista = pistaRef.current;
    if (!pista) return;
    const conScrollend = "onscrollend" in window;

    function alDesplazar() {
      if (cuadro.current == null && objetivo.current == null) {
        cuadro.current = requestAnimationFrame(() => {
          cuadro.current = null;
          const i = masCercana();
          setActual((previo) => (previo === i ? previo : i));
        });
      }
      if (!conScrollend) {
        if (espera.current) clearTimeout(espera.current);
        espera.current = setTimeout(asentar, ESPERA_SIN_SCROLLEND_MS);
      }
    }

    pista.addEventListener("scroll", alDesplazar, { passive: true });
    if (conScrollend) pista.addEventListener("scrollend", asentar);
    return () => {
      pista.removeEventListener("scroll", alDesplazar);
      if (conScrollend) pista.removeEventListener("scrollend", asentar);
      if (cuadro.current != null) cancelAnimationFrame(cuadro.current);
      if (espera.current) clearTimeout(espera.current);
    };
  }, [asentar, masCercana]);

  // Un boton que se deshabilita con el foco encima lo perderia: pasa al otro.
  useEffect(() => {
    const activo = document.activeElement;
    if (activo === anteriorRef.current && asentada === 0) siguienteRef.current?.focus();
    if (activo === siguienteRef.current && asentada === total - 1) anteriorRef.current?.focus();
  }, [asentada, total]);

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    // Solo con el foco en la pista: los controles del video usan sus flechas.
    if (e.target !== e.currentTarget) return;
    const pasos: Record<string, () => void> = {
      ArrowLeft: () => mover(-1),
      ArrowRight: () => mover(1),
      Home: () => irA(0),
      End: () => irA(total - 1),
    };
    const accion = pasos[e.key];
    if (!accion) return;
    e.preventDefault();
    accion();
  }

  const boton =
    "pointer-events-auto inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border border-[#C5A55A]/50 bg-black/70 text-[#E8D5A3] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A] disabled:pointer-events-none disabled:opacity-30";

  return (
    <div
      role="group"
      aria-roledescription="carrusel"
      aria-label={`Fotos y videos de ${nombreModelo}`}
    >
      <div className="relative">
        {/* Antes que la pista en el DOM, como pide el patron; encima en pantalla. */}
        <div className="pointer-events-none absolute inset-x-2 top-1/2 z-10 flex -translate-y-1/2 justify-between">
          <button
            ref={anteriorRef}
            type="button"
            onClick={() => mover(-1)}
            disabled={asentada === 0}
            aria-label="Diapositiva anterior"
            className={boton}
          >
            <ChevronLeft aria-hidden="true" className="h-5 w-5" />
          </button>
          <button
            ref={siguienteRef}
            type="button"
            onClick={() => mover(1)}
            disabled={asentada === total - 1}
            aria-label="Diapositiva siguiente"
            className={boton}
          >
            <ChevronRight aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={pistaRef}
          tabIndex={0}
          role="group"
          aria-label="Diapositivas"
          onKeyDown={alTeclear}
          className="relative flex w-full touch-manipulation snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-black [scrollbar-width:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#C5A55A] [&::-webkit-scrollbar]:hidden"
          style={{ aspectRatio: proporcion }}
        >
          {media.map((m, i) => (
            <div
              key={m.id}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={etiquetaDeDiapositiva(m.kind, i, total)}
              className="relative h-full w-full flex-none snap-center"
            >
              <Diapositiva
                media={m}
                indice={i}
                total={total}
                nombreModelo={nombreModelo}
                prioridad={prioridad}
              />
            </div>
          ))}
        </div>
      </div>

      <p role="status" className="sr-only">
        {anuncio}
      </p>

      <div
        role="group"
        aria-label="Elegir diapositiva"
        className="flex flex-wrap justify-center gap-1 pt-2"
      >
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => irA(i)}
            aria-label={etiquetaDeDiapositiva(m.kind, i, total)}
            aria-current={i === actual ? "true" : undefined}
            className="group inline-flex h-6 min-w-6 touch-manipulation items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#C5A55A]"
          >
            {/* El activo es mas ancho, no solo de otro color. */}
            <span
              aria-hidden="true"
              className="block h-1.5 w-1.5 rounded-full bg-zinc-600 transition-all group-hover:bg-[#8B7635] group-aria-[current=true]:w-4 group-aria-[current=true]:bg-[#C5A55A] motion-reduce:transition-none"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
