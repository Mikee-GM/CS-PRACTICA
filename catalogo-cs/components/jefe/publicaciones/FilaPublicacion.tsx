import { ImageIcon, PlayCircle } from "lucide-react";

import { mediaOrdenada } from "@/lib/posts";
import {
  esEdicionDeAprobado,
  etiquetaDeAutor,
  etiquetaDeEstadoDelPost,
  resumenDeMedia,
  tiempoEnCola,
  type PostDelEquipo,
} from "@/lib/posts-del-equipo";

/**
 * Una publicacion en la cola: miniatura, modelo, quien la escribio, cuanto
 * lleva esperando y cuantas medias trae. Lo que distingue a una fila (edicion
 * de algo publicado, autor del equipo) va en texto, no solo en color.
 */
export default function FilaPublicacion({
  post,
  seleccionada,
  domId,
  ahora,
  onAbrir,
}: {
  post: PostDelEquipo;
  seleccionada: boolean;
  domId: string;
  ahora: Date;
  onAbrir: () => void;
}) {
  const portada = mediaOrdenada(post.media)[0];
  const miniatura = portada ? (portada.kind === "video" ? portada.posterUrl : portada.url) : null;
  const pendiente = post.status === "pendiente";
  const momento = pendiente ? post.submittedAt : (post.reviewedAt ?? post.createdAt);
  const cuando = tiempoEnCola(momento, ahora);
  const edicion = esEdicionDeAprobado(post);

  return (
    <li>
      <button
        id={domId}
        type="button"
        onClick={onAbrir}
        aria-current={seleccionada ? "true" : undefined}
        className={`flex w-full gap-3 border-b border-zinc-900 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/60 ${
          seleccionada ? "bg-[#C5A55A]/10" : "hover:bg-zinc-950"
        }`}
      >
        <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          {miniatura ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={miniatura}
              alt=""
              width={64}
              height={64}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-zinc-700">
              <ImageIcon aria-hidden="true" size={20} />
            </span>
          )}
          {portada?.kind === "video" ? (
            <PlayCircle
              aria-hidden="true"
              className="absolute bottom-1 right-1 h-4 w-4 text-white drop-shadow"
            />
          ) : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-white">
              {post.employee.nombreArtistico}
            </span>
            {cuando ? (
              <time
                dateTime={momento ?? undefined}
                className="shrink-0 text-[10px] tabular-nums text-zinc-500"
              >
                {pendiente ? `En cola ${cuando}` : cuando}
              </time>
            ) : null}
          </span>
          <span className="line-clamp-1 text-xs text-zinc-400">
            {post.caption.trim() || "Sin texto"}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]">
            <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-400">
              {resumenDeMedia(post.media)}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${
                post.authorRole === "empleada"
                  ? "border-zinc-800 text-zinc-500"
                  : "border-[#C5A55A]/50 text-[#E8D5A3]"
              }`}
            >
              Autor: {etiquetaDeAutor(post.authorRole)}
            </span>
            {pendiente ? null : (
              <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-500">
                {etiquetaDeEstadoDelPost(post.status)}
              </span>
            )}
            {edicion ? (
              <span className="rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-2 py-0.5 text-[#E8D5A3]">
                Edición
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}
