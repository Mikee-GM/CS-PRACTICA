import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import AvatarModelo from "@/components/cliente/AvatarModelo";
import BotonChatear from "@/components/cliente/BotonChatear";
import { ErrorDeFormulario } from "@/components/cliente/Campo";
import ListaChats from "@/components/cliente/ListaChats";
import NavegacionCliente from "@/components/cliente/NavegacionCliente";
import TransicionDePestana from "@/components/cliente/TransicionDePestana";
import { getCurrentUser } from "@/lib/auth";
import type { ResumenDeConversacion } from "@/lib/conversaciones";
import { getCatalogModelos } from "@/lib/data/catalog";
import { getConversaciones } from "@/lib/data/conversaciones";
import { optionalSource } from "@/lib/optional-source";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Mis chats | Colombia Sexys",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bandeja del cliente.
 *
 * Con `?modelo=<id>` ofrece ademas abrir el chat con esa modelo: es el regreso
 * del boton "Chatear" del catalogo cuando no habia sesion. No se abre solo al
 * cargar porque crear la conversacion es una escritura, y una pagina que
 * escribe al pedirse la dispara tambien cualquier precarga del navegador.
 */
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ modelo?: string }>;
}) {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar?siguiente=%2Fchats");
  if (usuario.rol !== "cliente") redirect(inicioParaRol(usuario.rol));

  const { modelo: modeloId } = await searchParams;
  const pedirModelo = modeloId && UUID.test(modeloId) ? modeloId : null;

  const [conversaciones, catalogo] = await Promise.all([
    optionalSource<ResumenDeConversacion[] | null>(getConversaciones(), null, "chats"),
    pedirModelo
      ? optionalSource(getCatalogModelos(false), [], "chats (catalogo)")
      : Promise.resolve([]),
  ]);
  const modelo = pedirModelo ? catalogo.find((m) => m._id === pedirModelo) : undefined;

  return (
    <>
      <NavegacionCliente />
      <TransicionDePestana>
        <main className="min-h-dvh bg-[#050505] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] md:pt-8">
          <div className="mx-auto w-full max-w-xl space-y-6">
            <header className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C5A55A]/60">
                  Colombia Sexys
                </p>
                <h1 className="mt-2 font-heading text-3xl font-semibold text-white">
                  Mis chats
                </h1>
              </div>
              {/* "Mi perfil" vive en la barra del area del cliente. */}
              <Link
                href="/"
                className="inline-flex min-h-11 items-center px-3 text-xs font-medium text-zinc-400 underline-offset-4 hover:text-[#E8D5A3] hover:underline"
              >
                Catálogo
              </Link>
            </header>

            {modelo ? (
              <section
                aria-labelledby="continuar-con"
                className="flex flex-col gap-4 rounded-2xl border border-[#C5A55A]/40 bg-zinc-950/80 p-5"
              >
                <div className="flex items-center gap-3">
                  <AvatarModelo nombre={modelo.nombre} fotoUrl={modelo.fotoPrincipal || null} />
                  <div>
                    <h2 id="continuar-con" className="font-heading text-xl text-white">
                      Continuar con {modelo.nombre}
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Abre el chat con su asistente virtual.
                    </p>
                  </div>
                </div>
                <BotonChatear employeeId={modelo._id} nombre={modelo.nombre} />
              </section>
            ) : null}

            {conversaciones ? (
              <ListaChats conversaciones={conversaciones} />
            ) : (
              <ErrorDeFormulario mensaje="No se pudieron cargar tus chats. Revisa tu conexión y recarga la página." />
            )}
          </div>
        </main>
      </TransicionDePestana>
    </>
  );
}
