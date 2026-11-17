import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import AvatarModelo from "@/components/cliente/AvatarModelo";
import BotonChatear from "@/components/cliente/BotonChatear";
import FichaModelo, { estadoDeContacto } from "@/components/FichaModelo";
import SesionDelPerfil, {
  NavegacionDelPerfil,
  PublicacionesDelPerfil,
} from "@/components/feed/SesionDelPerfil";
import { getCatalogModelos } from "@/lib/data/catalog";
import { rutaDelPerfil } from "@/lib/posts";
import type { Modelo } from "@/types";

/*
 * El perfil se prerenderiza como el catalogo (ISR): la ficha es la misma
 * informacion publica, sale del mismo `getCatalogModelos` cacheado y se revalida
 * al mismo ritmo. Tiene que ser un literal, igual que en `app/page.tsx`; debe
 * coincidir con CATALOG_REVALIDATE_SECONDS.
 *
 * Nada de esta pagina lee cookies: lo que depende de la sesion (barra del
 * cliente y publicaciones) lo resuelve `SesionDelPerfil` en el navegador. Si el
 * render llamara a `getCurrentUser`, la pagina entera pasaria a ser dinamica
 * para todos los visitantes, tambien para los que no tienen cuenta.
 */
export const revalidate = 30;

/** Una modelo dada de alta despues del build se genera al primer visitante. */
export const dynamicParams = true;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const modelos = await getCatalogModelos(false);
  return modelos.flatMap((m) => (m.slug ? [{ slug: m.slug }] : []));
}

type Props = { params: Promise<{ slug: string }> };

/**
 * La modelo del catalogo con este slug. El segmento puede llegar codificado
 * (el slug se captura a mano y no tiene formato garantizado), asi que se
 * compara tambien decodificado.
 */
async function modeloDelSlug(slug: string): Promise<Modelo | undefined> {
  let decodificado = slug;
  try {
    decodificado = decodeURIComponent(slug);
  } catch {
    // Una secuencia `%` invalida no es un slug de nadie; se compara tal cual.
  }
  const modelos = await getCatalogModelos(false);
  return modelos.find((m) => m.slug && (m.slug === slug || m.slug === decodificado));
}

/**
 * Se indexa: el HTML solo lleva la ficha, que es lo mismo que el catalogo ya
 * publica. Las publicaciones nunca estan en el HTML (se piden con sesion de
 * cliente despues de montar), asi que indexar no expone nada de lo que exige
 * la declaracion 18+.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const modelo = await modeloDelSlug(slug);
  if (!modelo || !modelo.slug) {
    return { title: "Modelo no encontrada | Colombia Sexys", robots: { index: false } };
  }

  const titulo = `${modelo.nombre} | Colombia Sexys`;
  const descripcion =
    (modelo.descripcion ?? "").trim().replace(/\s+/g, " ").slice(0, 160) ||
    `Perfil de ${modelo.nombre} en el catálogo premium de Colombia Sexys.`;
  const ruta = rutaDelPerfil(modelo.slug);
  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: ruta },
    openGraph: {
      title: titulo,
      description: descripcion,
      url: ruta,
      siteName: "Colombia Sexys",
      type: "profile",
      locale: "es_MX",
      ...(modelo.fotoPrincipal
        ? { images: [{ url: modelo.fotoPrincipal, alt: modelo.nombre }] }
        : {}),
    },
  };
}

export default async function PerfilModeloPage({ params }: Props) {
  const { slug } = await params;
  const modelo = await modeloDelSlug(slug);
  if (!modelo || !modelo.slug) notFound();

  const { status, canContact } = estadoDeContacto(modelo);

  return (
    <SesionDelPerfil slug={modelo.slug}>
      <NavegacionDelPerfil />
      <main className="min-h-dvh bg-[#050505] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] md:pt-8">
        <div className="mx-auto w-full max-w-xl space-y-8">
          <Link
            href="/#catalogo"
            className="inline-flex min-h-11 items-center text-xs font-medium text-zinc-400 underline-offset-4 hover:text-[#E8D5A3] hover:underline"
          >
            Volver al catálogo
          </Link>

          <article aria-labelledby="nombre-modelo" className="space-y-6">
            <header className="flex items-center gap-5">
              <AvatarModelo nombre={modelo.nombre} fotoUrl={modelo.fotoPrincipal || null} tamano={96} />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C5A55A]/60">
                  Colombia Sexys
                </p>
                <h1
                  id="nombre-modelo"
                  className="mt-1 font-heading text-3xl font-semibold tracking-wide text-white [overflow-wrap:anywhere] [text-wrap:balance] sm:text-4xl"
                >
                  {modelo.nombre}
                </h1>
              </div>
            </header>

            <div>
              <FichaModelo modelo={modelo} nivelDeTitulo="h2" />
            </div>

            <div className="max-w-sm">
              {canContact ? (
                <BotonChatear employeeId={modelo._id} nombre={modelo.nombre} />
              ) : (
                <p className="flex min-h-12 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  {status}
                </p>
              )}
            </div>
          </article>

          <section aria-labelledby="titulo-publicaciones" className="space-y-4 border-t border-zinc-900 pt-8">
            <h2
              id="titulo-publicaciones"
              className="font-heading text-2xl font-semibold text-white"
            >
              Publicaciones
            </h2>
            <PublicacionesDelPerfil nombre={modelo.nombre} />
          </section>
        </div>
      </main>
    </SesionDelPerfil>
  );
}
