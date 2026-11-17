import type { ReactNode } from "react";

/**
 * Marco de cada bloque de `/cuenta`: la misma tarjeta de las pantallas de
 * acceso (`AuthShell`), con su titulo enlazado a la seccion para que los
 * lectores de pantalla la anuncien por nombre.
 */
export default function TarjetaDePerfil({
  id,
  titulo,
  destacada = false,
  children,
}: {
  id: string;
  titulo: string;
  /** Borde dorado para lo que el cliente debe leer primero. */
  destacada?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`rounded-2xl border bg-zinc-950/80 p-5 sm:p-6 ${
        destacada ? "border-[#8B7635]/70" : "border-zinc-800/60"
      }`}
    >
      <h2
        id={id}
        className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#C5A55A]/70"
      >
        {titulo}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
