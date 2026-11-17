"use client";

import { useId, useState } from "react";
import type { ChangeEvent, FocusEvent, InputHTMLAttributes } from "react";

const entrada =
  "w-full rounded-lg border border-zinc-800 bg-black/40 px-4 py-3.5 text-sm font-medium tracking-wide text-white transition-colors duration-300 placeholder:text-zinc-600 focus:border-[#C5A55A]/60 focus:bg-black/60 focus:outline-none focus:ring-4 focus:ring-[#C5A55A]/10 aria-[invalid=true]:border-red-500/70 aria-[invalid=true]:bg-red-950/20";

function IconoError() {
  return (
    <svg
      role="img"
      aria-label="Error"
      viewBox="0 0 20 20"
      className="mt-0.5 h-4 w-4 shrink-0"
      fill="currentColor"
    >
      <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm-.75 4.25a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-1.5 0v-4.5Zm.75 8.9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
    </svg>
  );
}

/**
 * Estado de un campo con validacion diferida: el error aparece cuando la
 * persona ya terminó con el campo (lo modificó y salió de el) o intentó enviar
 * el formulario, nunca mientras escribe. En cuanto el valor vuelve a ser
 * válido, el error desaparece.
 *
 * Espeja en `aria-invalid` lo que el navegador marca con `:user-invalid`,
 * porque ese pseudo-selector no actualiza el estado accesible por si solo.
 */
function useValidacionDiferida() {
  const [interactuo, setInteractuo] = useState(false);
  const [valido, setValido] = useState(true);

  return {
    mostrarError: interactuo && !valido,
    alCambiar(e: ChangeEvent<HTMLInputElement>) {
      setInteractuo(true);
      setValido(e.currentTarget.validity.valid);
    },
    alSalir(e: FocusEvent<HTMLInputElement>) {
      if (e.currentTarget.value !== "") setInteractuo(true);
      setValido(e.currentTarget.validity.valid);
    },
    // Un intento de envio cuenta como interaccion, incluso en campos vacios.
    alInvalidar() {
      setInteractuo(true);
      setValido(false);
    },
  };
}

type CampoProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "className" | "aria-invalid" | "aria-describedby"
> & {
  etiqueta: string;
  /** Texto que dice como corregir el campo; se muestra solo si hay error. */
  error: string;
  /** Ayuda visible siempre, encima del campo para que el teclado no la tape. */
  ayuda?: string;
};

export default function Campo({
  etiqueta,
  error,
  ayuda,
  onChange,
  onBlur,
  onInvalid,
  ...resto
}: CampoProps) {
  const id = useId();
  const v = useValidacionDiferida();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  // El error solo se enlaza al campo mientras se muestra: un
  // aria-describedby hacia texto oculto se lee igual desde que carga la pagina.
  const describedBy =
    [ayuda ? idAyuda : null, v.mostrarError ? idError : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 ml-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400"
      >
        {etiqueta}
      </label>
      {ayuda ? (
        <p id={idAyuda} className="mb-2 ml-1 text-xs text-zinc-500">
          {ayuda}
        </p>
      ) : null}
      <input
        {...resto}
        id={id}
        className={entrada}
        aria-invalid={v.mostrarError}
        aria-describedby={describedBy}
        onChange={(e) => {
          v.alCambiar(e);
          onChange?.(e);
        }}
        onBlur={(e) => {
          v.alSalir(e);
          onBlur?.(e);
        }}
        onInvalid={(e) => {
          v.alInvalidar();
          onInvalid?.(e);
        }}
      />
      {v.mostrarError ? (
        <p
          id={idError}
          className="mt-2 flex items-start gap-2 text-xs font-medium text-red-400"
        >
          <IconoError />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Casilla obligatoria con el mismo criterio de validacion diferida. */
export function CasillaObligatoria({
  etiqueta,
  error,
  ...resto
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "className" | "type" | "aria-invalid" | "aria-describedby"
> & { etiqueta: React.ReactNode; error: string }) {
  const id = useId();
  const idError = `${id}-error`;
  const [mostrarError, setMostrarError] = useState(false);

  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          {...resto}
          id={id}
          type="checkbox"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#C5A55A]"
          aria-invalid={mostrarError}
          aria-describedby={mostrarError ? idError : undefined}
          onChange={(e) => {
            setMostrarError(!e.currentTarget.validity.valid);
            resto.onChange?.(e);
          }}
          onInvalid={(e) => {
            setMostrarError(true);
            resto.onInvalid?.(e);
          }}
        />
        <label htmlFor={id} className="text-xs leading-relaxed text-zinc-400">
          {etiqueta}
        </label>
      </div>
      {mostrarError ? (
        <p
          id={idError}
          className="mt-2 flex items-start gap-2 text-xs font-medium text-red-400"
        >
          <IconoError />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Mensaje de error del servidor al final del formulario. */
export function ErrorDeFormulario({ mensaje }: { mensaje: string }) {
  if (!mensaje) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-3 text-xs font-medium text-red-400"
    >
      <IconoError />
      <span>{mensaje}</span>
    </p>
  );
}

export const botonPrimario =
  "flex w-full items-center justify-center gap-2 rounded-lg bg-[#C5A55A] py-4 text-xs font-black uppercase tracking-[0.2em] text-black transition-all duration-300 hover:bg-[#D4AF37] hover:shadow-[0_0_20px_rgba(197,165,90,0.25)] disabled:opacity-50";
