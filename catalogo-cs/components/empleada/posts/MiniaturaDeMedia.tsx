import Image from "next/image";
import { Film } from "lucide-react";

import { duracionCorta } from "@/lib/employee-posts";
import type { MediaDelPost } from "@/lib/posts";

/**
 * Miniatura cuadrada de una foto o un video ya subidos.
 *
 * Del video se pinta la portada, no el video: en una lista de gestion no hace
 * falta reproducir, y asi no se baja nada mas que la imagen. La duracion va en
 * texto encima para distinguirlo de una foto sin depender del icono.
 */
export default function MiniaturaDeMedia({
  media,
  etiqueta,
  sizes = "(min-width: 36rem) 12rem, 33vw",
}: {
  media: MediaDelPost;
  /** Nombre accesible, por ejemplo "Foto 2 de 5". */
  etiqueta: string;
  sizes?: string;
}) {
  const fuente = media.kind === "video" ? media.posterUrl : media.url;
  const duracion = media.kind === "video" ? duracionCorta(media.durationMs) : null;

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-zinc-800 bg-black">
      {fuente ? (
        <Image src={fuente} alt={etiqueta} fill sizes={sizes} className="object-cover" />
      ) : (
        <div
          role="img"
          aria-label={etiqueta}
          className="flex h-full w-full items-center justify-center text-zinc-600"
        >
          <Film aria-hidden="true" className="h-6 w-6" />
        </div>
      )}
      {media.kind === "video" ? (
        <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-[#E8D5A3]">
          <Film aria-hidden="true" className="h-3 w-3" />
          {duracion ? `Video ${duracion}` : "Video"}
        </span>
      ) : null}
    </div>
  );
}
