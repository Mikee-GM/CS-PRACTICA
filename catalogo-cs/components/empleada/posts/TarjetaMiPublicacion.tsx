import { Heart, Pencil, Trash2 } from "lucide-react";

import {
  accionesDisponibles,
  etiquetaDeEstado,
  motivoPendienteDeCorregir,
  nombreDeMedia,
  type PostDeLaModelo,
  type TonoDelEstado,
} from "@/lib/employee-posts";
import { fechaCompletaDelPost, fechaDelPost, mediaOrdenada, textoDeMeGusta } from "@/lib/posts";
import MiniaturaDeMedia from "./MiniaturaDeMedia";

/** Hasta cuantas miniaturas se pintan en la tarjeta; el resto se cuenta. */
const MINIATURAS = 3;

export const CLASE_DEL_TONO: Record<TonoDelEstado, string> = {
  neutro: "border-zinc-700 bg-zinc-800/40 text-zinc-300",
  revision: "border-[#C5A55A]/40 bg-[#C5A55A]/10 text-[#E8D5A3]",
  publicada: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  rechazada: "border-red-500/30 bg-red-500/10 text-red-200",
};

/** La fecha que importa segun el estado, con su verbo. */
function fechaRelevante(post: PostDeLaModelo): { texto: string; iso: string } {
  if (post.status === "aprobado" && post.publishedAt) {
    return { texto: "Publicada", iso: post.publishedAt };
  }
  if (post.status === "pendiente" && post.submittedAt) {
    return { texto: "Enviada", iso: post.submittedAt };
  }
  return { texto: "Creada", iso: post.createdAt };
}

/**
 * Una publicacion en la lista de la modelo.
 *
 * Es una ficha de gestion, no la tarjeta del feed: lo primero es en que estado
 * esta y que hay que hacer con ella. Por eso el estado va arriba y en texto
 * (el color solo acompaña) y el motivo de un rechazo se lee sin abrirla.
 */
export default function TarjetaMiPublicacion({
  post,
  onEditar,
  onBorrar,
}: {
  post: PostDeLaModelo;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  const estado = etiquetaDeEstado(post);
  const acciones = accionesDisponibles(post);
  const media = mediaOrdenada(post.media);
  const fecha = fechaRelevante(post);
  const motivoAnterior = motivoPendienteDeCorregir(post);
  const sobrantes = media.length - MINIATURAS;

  return (
    <article className="space-y-3 rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p
          className={`max-w-full rounded-lg border px-2.5 py-1 text-xs font-semibold leading-snug break-words ${CLASE_DEL_TONO[estado.tono]}`}
        >
          {estado.texto}
        </p>
        <p className="text-xs text-zinc-500">
          {fecha.texto}{" "}
          <time dateTime={fecha.iso} title={fechaCompletaDelPost(fecha.iso)}>
            {fechaDelPost(fecha.iso)}
          </time>
        </p>
      </div>

      {motivoAnterior ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs leading-relaxed text-red-200">
          <span className="block">{`Motivo del rechazo anterior: ${motivoAnterior}`}</span>
          <span className="block text-red-300/80">Corrígelo y envíala de nuevo a revisión.</span>
        </p>
      ) : null}

      {media.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" aria-label="Fotos y videos">
          {media.slice(0, MINIATURAS).map((m, i) => (
            <li key={m.id} className="relative">
              <MiniaturaDeMedia media={m} etiqueta={nombreDeMedia(m.kind, i, media.length)} />
              {i === MINIATURAS - 1 && sobrantes > 0 ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-sm font-semibold text-[#E8D5A3]">
                  {`+${sobrantes}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
          Sin fotos ni videos todavía.
        </p>
      )}

      {post.caption ? (
        <p className="line-clamp-3 whitespace-pre-line break-words text-sm leading-relaxed text-zinc-300">
          {post.caption}
        </p>
      ) : null}

      {post.status === "aprobado" ? (
        <p className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Heart aria-hidden="true" className="h-3.5 w-3.5 text-[#C5A55A]" />
          {textoDeMeGusta(post.likeCount)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {acciones.editar ? (
          <button
            type="button"
            onClick={onEditar}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#C5A55A]/70 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#E8D5A3] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
          >
            <Pencil aria-hidden="true" className="h-4 w-4" />
            Editar
          </button>
        ) : null}
        {acciones.borrar ? (
          <button
            type="button"
            onClick={onBorrar}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-800 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-red-500/60 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            {acciones.borrar === "archivar" ? "Archivar" : "Eliminar"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
