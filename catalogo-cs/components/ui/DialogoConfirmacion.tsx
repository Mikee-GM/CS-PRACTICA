"use client";

import { useEffect, useId, useRef } from "react";
import { Loader2 } from "lucide-react";

/**
 * Confirmacion previa a una accion: tomar, devolver, aceptar o rechazar en el
 * chat web del equipo; enviar a revision, editar algo publicado o borrar en las
 * publicaciones de la modelo.
 *
 * Se usa un `<dialog>` nativo abierto con `showModal()` en vez de
 * `ConfirmDialog` o `PromptDialog`: aquellos son capas dibujadas a mano, sin
 * semantica de dialogo, sin contener el foco ni cerrarse con Esc, y
 * `ConfirmDialog` ademas rotula todo como "Accion irreversible", que no vale
 * para tomar el control. El nativo da todo eso y devuelve el foco al boton que
 * lo abrio.
 *
 * Mientras la accion esta en curso no se deja cerrar: un Esc a mitad dejaria
 * la peticion viva y la persona sin saber como acabo.
 */
export default function DialogoConfirmacion({
  abierto,
  titulo,
  descripcion,
  etiquetaConfirmar,
  tono = "dorado",
  ocupado,
  error,
  motivo,
  children,
  onConfirmar,
  onCerrar,
}: {
  abierto: boolean;
  titulo: string;
  descripcion: string;
  etiquetaConfirmar: string;
  tono?: "dorado" | "rojo";
  ocupado: boolean;
  error: string;
  /** Campo de texto opcional (por ejemplo, el motivo de un rechazo). */
  motivo?: {
    etiqueta: string;
    ayuda: string;
    max: number;
    valor: string;
    onCambio: (valor: string) => void;
  };
  children?: React.ReactNode;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const tituloId = `${id}-titulo`;
  const descripcionId = `${id}-descripcion`;
  const errorId = `${id}-error`;
  const motivoId = `${id}-motivo`;
  const ayudaId = `${id}-ayuda`;

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  const peligro = tono === "rojo";

  return (
    <dialog
      ref={ref}
      aria-labelledby={tituloId}
      aria-describedby={descripcionId}
      onCancel={(evento) => {
        if (ocupado) evento.preventDefault();
      }}
      onClose={() => {
        if (abierto) onCerrar();
      }}
      className="m-auto w-[min(100%-2rem,28rem)] overscroll-contain rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-0 text-white shadow-2xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          if (!ocupado) onConfirmar();
        }}
        className="space-y-4 p-6"
      >
        <h2 id={tituloId} className="font-heading text-2xl font-semibold leading-tight text-white">
          {titulo}
        </h2>
        <p id={descripcionId} className="text-sm leading-relaxed text-zinc-400">
          {descripcion}
        </p>

        {children}

        {motivo ? (
          <div className="space-y-1.5">
            <label htmlFor={motivoId} className="block text-xs font-semibold text-zinc-300">
              {motivo.etiqueta}
            </label>
            <textarea
              id={motivoId}
              rows={3}
              maxLength={motivo.max}
              value={motivo.valor}
              onChange={(evento) => motivo.onCambio(evento.target.value)}
              aria-describedby={ayudaId}
              autoFocus
              className="w-full rounded-xl border border-zinc-800 bg-black p-3 text-base text-white outline-none placeholder:text-zinc-600 focus:border-[#C5A55A] sm:text-sm"
            />
            <p id={ayudaId} className="flex justify-between gap-2 text-[11px] text-zinc-500">
              <span>{motivo.ayuda}</span>
              <span className="tabular-nums">
                {motivo.valor.length} / {motivo.max}
              </span>
            </p>
          </div>
        ) : null}

        {/* Espacio reservado: que aparezca el error no mueve los botones. */}
        <p id={errorId} role="alert" className="min-h-5 text-sm text-red-400">
          {error}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={ocupado}
            onClick={onCerrar}
            autoFocus={peligro && !motivo}
            className="min-h-11 rounded-xl border border-zinc-800 px-5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={ocupado}
            aria-busy={ocupado}
            aria-describedby={error ? errorId : undefined}
            autoFocus={!peligro && !motivo}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 text-xs font-semibold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 ${
              peligro
                ? "border-red-500/60 text-red-300 hover:bg-red-500 hover:text-black focus-visible:ring-red-400/60"
                : "border-[#C5A55A]/70 text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black focus-visible:ring-[#C5A55A]/60"
            }`}
          >
            {ocupado ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
            {ocupado ? "Procesando" : etiquetaConfirmar}
          </button>
        </div>
      </form>
    </dialog>
  );
}
