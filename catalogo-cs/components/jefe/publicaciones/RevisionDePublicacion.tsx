"use client";

import { useId, useState, type Ref } from "react";
import { ArrowLeft, Archive, Check, X } from "lucide-react";

import DialogoConfirmacion from "@/components/jefe/chats-web/DialogoConfirmacion";
import VisorDeImagen from "@/components/jefe/chats-web/VisorDeImagen";
import {
  aprobarPostAction,
  archivarPostAction,
  rechazarPostAction,
} from "@/lib/actions/posts-del-equipo";
import { fechaCompletaDelPost, mediaOrdenada } from "@/lib/posts";
import {
  accionesDelPost,
  esEdicionDeAprobado,
  etiquetaDeAutor,
  etiquetaDeEstadoDelPost,
  MAX_MOTIVO_DE_RECHAZO,
  motivoParaNoAprobar,
  mediasSinRevisar,
  validarMotivo,
  type AccionDelPost,
  type PostDelEquipo,
} from "@/lib/posts-del-equipo";
import MediaEnRevision from "./MediaEnRevision";

const TEXTOS_DEL_DIALOGO: Record<
  AccionDelPost,
  { titulo: string; confirmar: string; tono: "dorado" | "rojo" }
> = {
  aprobar: { titulo: "Aprobar publicación", confirmar: "Aprobar", tono: "dorado" },
  rechazar: { titulo: "Rechazar publicación", confirmar: "Rechazar", tono: "rojo" },
  archivar: { titulo: "Archivar publicación", confirmar: "Archivar", tono: "rojo" },
};

function descripcionDelDialogo(accion: AccionDelPost, post: PostDelEquipo): string {
  if (accion === "aprobar") {
    return esEdicionDeAprobado(post)
      ? "Vuelve al feed de los clientes con sus likes y la modelo recibe un aviso."
      : "Se publica en el feed de los clientes y la modelo recibe un aviso.";
  }
  if (accion === "rechazar") {
    return "La modelo verá el motivo en su portal y podrá corregirla y enviarla de nuevo.";
  }
  return "Deja de verse en el feed y no se puede deshacer. La modelo no recibe aviso.";
}

/**
 * Revision de una publicacion: todas las medias a tamaño util, el texto
 * completo, su estado y las decisiones.
 *
 * Aprobar no se deshabilita: un boton deshabilitado no recibe foco ni explica
 * por que. Mientras falte alguna media por revisar, pulsarlo dice cual y lleva
 * el foco a ella; con todo revisado abre la confirmacion.
 */
export default function RevisionDePublicacion({
  post,
  revisadas,
  onRevisada,
  onDecidido,
  onConflicto,
  onVolver,
  tituloRef,
  barraClassName = "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4",
}: {
  post: PostDelEquipo;
  revisadas: ReadonlySet<string>;
  onRevisada: (mediaId: string) => void;
  /** La accion salio bien: la cola quita el post y pasa al siguiente. */
  onDecidido: (accion: AccionDelPost, actualizado: PostDelEquipo) => void;
  /** 409 o 404: el estado cambio en el servidor y hay que releer la cola. */
  onConflicto: (mensaje: string) => void;
  onVolver: () => void;
  /** El titulo recibe el foco al cambiar de publicacion. */
  tituloRef?: Ref<HTMLHeadingElement>;
  /**
   * Donde se pega la barra de acciones: sobre la barra inferior del panel de
   * jefe, o sobre el borde de la pantalla en el de admin, que no la tiene.
   */
  barraClassName?: string;
}) {
  const idBase = useId();
  const [dialogo, setDialogo] = useState<AccionDelPost | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [avisoRevision, setAvisoRevision] = useState("");
  const [imagen, setImagen] = useState<{ url: string; titulo: string } | null>(null);

  const media = mediaOrdenada(post.media);
  const acciones = accionesDelPost(post);
  const edicion = esEdicionDeAprobado(post);
  const revisadasAqui = media.filter((m) => revisadas.has(m.id)).length;
  const avisoId = `${idBase}-aviso`;
  const domIdDeMedia = (id: string) => `${idBase}-media-${id}`;

  function abrir(accion: AccionDelPost) {
    setError("");
    if (accion === "aprobar") {
      const falta = motivoParaNoAprobar(media, revisadas);
      if (falta) {
        setAvisoRevision(falta);
        const primera = mediasSinRevisar(media, revisadas)[0];
        if (primera) {
          const destino = document.getElementById(domIdDeMedia(primera.media.id));
          destino?.scrollIntoView({ block: "center" });
          destino?.focus({ preventScroll: true });
        }
        return;
      }
    }
    setAvisoRevision("");
    if (accion === "rechazar") setMotivo("");
    setDialogo(accion);
  }

  async function confirmar() {
    if (!dialogo) return;
    let resultado;
    setError("");
    if (dialogo === "rechazar") {
      const validado = validarMotivo(motivo);
      if ("error" in validado) {
        setError(validado.error);
        return;
      }
      setOcupado(true);
      resultado = await rechazarPostAction(post.id, validado.motivo);
    } else {
      setOcupado(true);
      resultado =
        dialogo === "aprobar"
          ? await aprobarPostAction(post.id)
          : await archivarPostAction(post.id);
    }
    setOcupado(false);
    const accion = dialogo;
    if (resultado.success) {
      setDialogo(null);
      onDecidido(accion, resultado.data);
      return;
    }
    if (resultado.conflicto) {
      setDialogo(null);
      onConflicto(resultado.error);
      return;
    }
    setError(resultado.error);
  }

  const textos = dialogo ? TEXTOS_DEL_DIALOGO[dialogo] : null;

  return (
    <article aria-labelledby={`${idBase}-titulo`} className="space-y-5">
      <header className="space-y-3">
        <button
          type="button"
          onClick={onVolver}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 hover:text-[#C5A55A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 lg:hidden"
        >
          <ArrowLeft aria-hidden="true" size={16} /> Volver a la cola
        </button>
        <div className="flex items-center gap-3">
          {post.employee.fotoPerfilUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.employee.fotoPerfilUrl}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-full border border-zinc-800 object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C5A55A]">
              {etiquetaDeEstadoDelPost(post.status)}
            </p>
            <h2
              id={`${idBase}-titulo`}
              ref={tituloRef}
              tabIndex={-1}
              className="scroll-mt-20 truncate font-heading text-2xl font-semibold text-white focus:outline-none"
            >
              Publicación de {post.employee.nombreArtistico}
            </h2>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-zinc-500">Autor</dt>
            <dd className="text-zinc-300">{etiquetaDeAutor(post.authorRole)}</dd>
          </div>
          {post.submittedAt ? (
            <div className="flex gap-2">
              <dt className="text-zinc-500">Enviada</dt>
              <dd className="text-zinc-300">{fechaCompletaDelPost(post.submittedAt)}</dd>
            </div>
          ) : null}
          {post.publishedAt ? (
            <div className="flex gap-2">
              <dt className="text-zinc-500">Publicada</dt>
              <dd className="text-zinc-300">{fechaCompletaDelPost(post.publishedAt)}</dd>
            </div>
          ) : null}
          {post.reviewedAt ? (
            <div className="flex gap-2">
              <dt className="text-zinc-500">Revisada</dt>
              <dd className="text-zinc-300">{fechaCompletaDelPost(post.reviewedAt)}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="text-zinc-500">Likes</dt>
            <dd className="tabular-nums text-zinc-300">{post.likeCount}</dd>
          </div>
        </dl>
      </header>

      {edicion ? (
        <p className="rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-3 text-sm text-[#E8D5A3]">
          Edición de una publicación ya aprobada; conserva sus likes. Mientras esté en revisión no
          se ve en el feed.
        </p>
      ) : null}

      {post.rejectionReason ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {post.status === "rechazado" ? "Motivo del rechazo" : "Motivo de un rechazo anterior"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{post.rejectionReason}</p>
        </div>
      ) : null}

      <section aria-labelledby={`${idBase}-texto`} className="space-y-1.5">
        <h3
          id={`${idBase}-texto`}
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
        >
          Texto
        </h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
          {post.caption.trim() || "Sin texto."}
        </p>
      </section>

      <section aria-labelledby={`${idBase}-media`} className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3
            id={`${idBase}-media`}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
          >
            Medias
          </h3>
          {acciones.aprobar ? (
            <p className="text-xs tabular-nums text-zinc-400">
              Revisadas {revisadasAqui} de {media.length}
            </p>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {media.map((m, indice) => (
            <MediaEnRevision
              key={m.id}
              media={m}
              indice={indice}
              total={media.length}
              modelo={post.employee.nombreArtistico}
              revisada={revisadas.has(m.id)}
              domId={domIdDeMedia(m.id)}
              onRevisada={() => onRevisada(m.id)}
              onAmpliar={setImagen}
            />
          ))}
        </div>
      </section>

      {acciones.aprobar || acciones.rechazar || acciones.archivar ? (
        // Pegada abajo en el telefono para no tener que volver a subir tras ver
        // la ultima media; respeta el indicador de inicio y la barra del panel.
        <div className={`sticky ${barraClassName} z-10 -mx-1 space-y-2 rounded-xl border border-zinc-800 bg-[#050505]/95 p-3 backdrop-blur`}>
          {acciones.aprobar ? (
            <p id={avisoId} aria-live="polite" className="text-xs leading-relaxed text-zinc-400">
              {avisoRevision ? (
                <span className="font-semibold text-[#E8D5A3]">{avisoRevision}</span>
              ) : (
                "Revisa todas las medias antes de aprobar: cada foto a la vista y cada video completo."
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {acciones.aprobar ? (
              <button
                type="button"
                onClick={() => abrir("aprobar")}
                aria-describedby={avisoId}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#C5A55A]/70 bg-[#C5A55A] px-4 text-xs font-semibold uppercase tracking-[0.14em] text-black transition-colors hover:bg-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8D5A3]"
              >
                <Check aria-hidden="true" size={16} /> Aprobar
              </button>
            ) : null}
            {acciones.rechazar ? (
              <button
                type="button"
                onClick={() => abrir("rechazar")}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/60 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-red-300 transition-colors hover:bg-red-500 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
              >
                <X aria-hidden="true" size={16} /> Rechazar
              </button>
            ) : null}
            {acciones.archivar ? (
              <button
                type="button"
                onClick={() => abrir("archivar")}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
              >
                <Archive aria-hidden="true" size={16} /> Archivar
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <DialogoConfirmacion
        abierto={dialogo !== null}
        titulo={textos?.titulo ?? ""}
        descripcion={dialogo ? descripcionDelDialogo(dialogo, post) : ""}
        etiquetaConfirmar={textos?.confirmar ?? ""}
        tono={textos?.tono ?? "dorado"}
        ocupado={ocupado}
        error={error}
        motivo={
          dialogo === "rechazar"
            ? {
                etiqueta: "Motivo del rechazo (obligatorio)",
                ayuda: "Dile a la modelo qué corregir. Lo verá tal cual.",
                max: MAX_MOTIVO_DE_RECHAZO,
                valor: motivo,
                onCambio: (valor) => {
                  setMotivo(valor);
                  if (error) setError("");
                },
              }
            : undefined
        }
        onConfirmar={() => void confirmar()}
        onCerrar={() => {
          if (ocupado) return;
          setDialogo(null);
          setError("");
        }}
      />
      <VisorDeImagen imagen={imagen} onCerrar={() => setImagen(null)} />
    </article>
  );
}
