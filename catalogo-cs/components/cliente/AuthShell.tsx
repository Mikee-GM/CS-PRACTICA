import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Marco comun de las pantallas de acceso del cliente: fondo negro, tarjeta con
 * borde dorado tenue y cabecera con el icono de la marca.
 */
export default function AuthShell({
  etiqueta,
  titulo,
  children,
  pie,
}: {
  etiqueta: string;
  titulo: string;
  children: ReactNode;
  pie?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#050505] px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(197,165,90,0.04)_0%,transparent_60%)]"
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/80 p-8 shadow-2xl backdrop-blur-sm sm:p-10">
          <header className="mb-8 flex flex-col items-center">
            <Link href="/" aria-label="Volver al catálogo" className="mb-5">
              <span className="relative block h-16 w-16">
                <Image
                  src="/logo-icono.webp"
                  alt="Colombia Sexys"
                  fill
                  sizes="64px"
                  className="object-contain drop-shadow-[0_0_15px_rgba(197,165,90,0.2)]"
                  priority
                />
              </span>
            </Link>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.4em] text-[#C5A55A]/60">
              {etiqueta}
            </p>
            <h1 className="text-center font-heading text-2xl font-semibold tracking-wide text-white">
              {titulo}
            </h1>
          </header>
          {children}
        </div>
        {pie ? (
          <p className="mt-6 text-center text-xs text-zinc-500">{pie}</p>
        ) : null}
      </div>
    </main>
  );
}
