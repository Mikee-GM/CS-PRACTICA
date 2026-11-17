"use client";

import { useEffect, useRef } from "react";

/** Por debajo de esta fraccion a la vista, el video se pausa. */
const VISIBLE_MINIMO = 0.25;

/**
 * Video de una publicacion.
 *
 * Nunca arranca solo: el feed es para hojearlo y un video con sonido sin
 * pedirlo es lo primero que hace que alguien cierre la pagina. Con
 * `preload="none"` no se baja nada hasta que la persona pulsa reproducir, y
 * `loading="lazy"` difiere ademas el poster donde el navegador lo admite (en
 * los demas se ignora y el poster se pide como siempre).
 *
 * Si sale de la pantalla --porque se hizo scroll o porque el carrusel paso a la
 * siguiente diapositiva-- se pausa: el observador tiene en cuenta el recorte
 * del carrusel, asi que un video desplazado fuera de su pista cuenta como
 * oculto aunque la tarjeta siga a la vista.
 */
export default function VideoPost({
  url,
  posterUrl,
  ancho,
  alto,
  etiqueta,
  diferido,
}: {
  url: string;
  posterUrl: string | null;
  ancho: number;
  alto: number;
  /** Nombre accesible, por ejemplo "Video 2 de 3 de Valentina". */
  etiqueta: string;
  /** Fuera de la primera pantalla: se difiere tambien el poster. */
  diferido: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada && entrada.intersectionRatio < VISIBLE_MINIMO && !video.paused) {
          video.pause();
        }
      },
      { threshold: [0, VISIBLE_MINIMO] },
    );
    observador.observe(video);
    return () => observador.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={url}
      poster={posterUrl ?? undefined}
      controls
      playsInline
      preload="none"
      // Atributo nuevo que React aun no tipa; donde no existe, se ignora.
      {...(diferido ? ({ loading: "lazy" } as Record<string, string>) : {})}
      // Dimensiones enteras: sin ellas un video sin cargar mide 300x150 y la
      // tarjeta salta al llegar el poster.
      width={ancho}
      height={alto}
      aria-label={etiqueta}
      className="h-full w-full bg-black object-contain"
    >
      Tu navegador no puede reproducir este video.
    </video>
  );
}
