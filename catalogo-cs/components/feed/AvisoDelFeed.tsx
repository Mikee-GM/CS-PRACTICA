import type { ReactNode } from "react";

/**
 * Bloque informativo en lugar de las publicaciones: no hay sesion, la cuenta
 * no las puede ver, la modelo ya no publica. Tiene la misma caja que el estado
 * vacio de `ListaPosts` para que todos los "aqui no hay posts" se lean igual.
 *
 * No es `role="alert"`: no es un error que haya que anunciar al cargar, es lo
 * que la pantalla tiene que decir, y se lee en su orden natural.
 */
export default function AvisoDelFeed({
  titulo,
  mensaje,
  children,
}: {
  titulo: string;
  mensaje: string;
  /** Acciones bajo el texto: entrar, crear cuenta, ir al panel. */
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={titulo}
      className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 px-6 py-10 text-center"
    >
      <p className="font-heading text-xl text-white">{titulo}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400 [text-wrap:pretty]">{mensaje}</p>
      {children ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>
      ) : null}
    </section>
  );
}

/** Titulo del aviso para una lectura del feed que no trae publicaciones. */
export function tituloDelAviso(estado: "sin-edad" | "no-disponible"): string {
  return estado === "sin-edad" ? "Confirmación de edad pendiente" : "Publicaciones no disponibles";
}

/** Enlaces de accion dentro del aviso, con los mismos estilos que los botones del area. */
export const accionPrincipal =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#C5A55A] px-5 text-xs font-bold uppercase tracking-[0.15em] text-black transition-colors hover:bg-[#D4AF37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]";

export const accionSecundaria =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#C5A55A]/60 px-5 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]";
