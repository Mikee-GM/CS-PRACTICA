import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import AvisoDelFeed, { tituloDelAviso } from "@/components/feed/AvisoDelFeed";
import ListaPosts from "@/components/feed/ListaPosts";
import NavegacionCliente from "@/components/cliente/NavegacionCliente";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/data/posts";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Publicaciones | Colombia Sexys",
  robots: { index: false },
};

/**
 * Feed general del cliente: la portada de su area.
 *
 * La primera pagina se resuelve aqui y `ListaPosts` pide las siguientes. Un
 * fallo de red llega a `ListaPosts` como `errorInicial`, que ya ofrece
 * reintentar; la cuenta sin declaracion 18+ o sin ficha no se reintenta, se
 * explica.
 */
export default async function FeedPage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar?siguiente=%2Ffeed");
  if (usuario.rol !== "cliente") redirect(inicioParaRol(usuario.rol));

  const lectura = await getFeed();

  return (
    <>
      <NavegacionCliente />
      <main className="min-h-dvh bg-[#050505] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] md:pt-8">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <header className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C5A55A]/60">
                Colombia Sexys
              </p>
              <h1 className="mt-2 font-heading text-3xl font-semibold text-white">
                Publicaciones
              </h1>
            </div>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center px-3 text-xs font-medium text-zinc-400 underline-offset-4 hover:text-[#E8D5A3] hover:underline"
            >
              Catálogo
            </Link>
          </header>

          {lectura.estado === "ok" || lectura.estado === "error" ? (
            <ListaPosts
              paginaInicial={
                lectura.estado === "ok" ? lectura.pagina : { items: [], nextCursor: null }
              }
              errorInicial={lectura.estado === "error"}
            />
          ) : (
            <AvisoDelFeed titulo={tituloDelAviso(lectura.estado)} mensaje={lectura.mensaje} />
          )}
        </div>
      </main>
    </>
  );
}
