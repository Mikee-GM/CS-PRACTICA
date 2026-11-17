"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ErrorDeFormulario } from "@/components/cliente/Campo";
import { pedirConSesion } from "@/lib/client-fetch";
import {
  loginConRegreso,
  rutaDelFeed,
  rutaDelPerfil,
  unirPaginas,
  type PaginaDeFeed,
  type PostDelFeed,
} from "@/lib/posts";
import TarjetaPost from "./TarjetaPost";

/**
 * Publicaciones que se pintan sin diferir su render: las que caben en la
 * primera pantalla de un telefono. Las demas llevan `content-visibility: auto`
 * para no pagar el layout de veinte carruseles que nadie esta viendo.
 */
const VISIBLES_AL_CARGAR = 2;

const botonSecundario =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#C5A55A]/60 px-5 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A] aria-disabled:opacity-50";

/**
 * Lista de publicaciones del feed general o del perfil de una modelo.
 *
 * Recibe la primera pagina ya resuelta en el servidor y pide las siguientes
 * con un boton, no con scroll infinito: asi el pie de la pagina sigue siendo
 * alcanzable y quien navega con teclado decide cuando cargar. La siguiente
 * pagina va por el proxy `/api/feed...` con `pedirConSesion`, que renueva la
 * sesion una vez ante un 401; si aun asi responde 401, la sesion termino y se
 * manda al login con regreso a esta pantalla.
 *
 * Al cargar, el foco pasa a la primera publicacion nueva: el boton baja al
 * final de la lista (o desaparece) y dejar el foco en el lo alejaria de lo que
 * se acaba de pedir.
 */
export default function ListaPosts({
  paginaInicial,
  slug,
  errorInicial = false,
}: {
  paginaInicial: PaginaDeFeed;
  /** Con slug, el perfil de esa modelo; sin el, el feed general. */
  slug?: string;
  /** La primera pagina no se pudo cargar en el servidor. */
  errorInicial?: boolean;
}) {
  const rutaDeRegreso = slug ? rutaDelPerfil(slug) : "/feed";
  const [posts, setPosts] = useState<PostDelFeed[]>(() =>
    unirPaginas([], paginaInicial.items),
  );
  const [cursor, setCursor] = useState<string | null>(paginaInicial.nextCursor);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(
    errorInicial ? "No se pudieron cargar las publicaciones. Revisa tu conexión y vuelve a intentarlo." : "",
  );
  // Sin nada en pantalla, reintentar es pedir la primera pagina otra vez.
  const [sinPrimeraPagina, setSinPrimeraPagina] = useState(errorInicial);
  const [enfocar, setEnfocar] = useState<string | null>(null);
  const tarjetas = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!enfocar) return;
    tarjetas.current.get(enfocar)?.focus();
    setEnfocar(null);
  }, [enfocar]);

  async function cargar() {
    if (cargando) return;
    const desde = sinPrimeraPagina ? null : cursor;
    if (!sinPrimeraPagina && !desde) return;
    setCargando(true);
    setError("");
    try {
      const respuesta = await pedirConSesion(rutaDelFeed({ slug, cursor: desde }), {
        cache: "no-store",
      });
      if (respuesta.status === 401) {
        window.location.assign(loginConRegreso(rutaDeRegreso));
        return;
      }
      if (!respuesta.ok) throw new Error(`estado ${respuesta.status}`);
      const pagina = (await respuesta.json()) as PaginaDeFeed;
      const items = Array.isArray(pagina?.items) ? pagina.items : [];
      const vistos = new Set(posts.map((p) => p.id));
      const primeraNueva = items.find((p) => !vistos.has(p.id));
      setPosts((actuales) => unirPaginas(actuales, items));
      setCursor(typeof pagina?.nextCursor === "string" ? pagina.nextCursor : null);
      setSinPrimeraPagina(false);
      if (primeraNueva && !sinPrimeraPagina) setEnfocar(primeraNueva.id);
    } catch {
      setError(
        sinPrimeraPagina
          ? "No se pudieron cargar las publicaciones. Revisa tu conexión y vuelve a intentarlo."
          : "No se pudieron cargar más publicaciones. Revisa tu conexión y vuelve a intentarlo.",
      );
    } finally {
      setCargando(false);
    }
  }

  const vacio = posts.length === 0 && !sinPrimeraPagina;

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {vacio ? (
        <div
          role="status"
          className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 px-6 py-10 text-center"
        >
          <p className="font-heading text-xl text-white">Aún no hay publicaciones</p>
          <p className="mt-2 text-sm text-zinc-400">
            {slug
              ? "Esta modelo todavía no ha publicado nada."
              : "Cuando las modelos publiquen, sus fotos y videos aparecerán aquí."}
          </p>
          {slug ? null : (
            <Link href="/#catalogo" className={`mt-6 ${botonSecundario}`}>
              Ver el catálogo
            </Link>
          )}
        </div>
      ) : null}

      {posts.length > 0 ? (
        <ol aria-label="Publicaciones" className="space-y-6">
          {posts.map((post, i) => (
            <li key={post.id}>
              <TarjetaPost
                ref={(nodo) => {
                  if (nodo) tarjetas.current.set(post.id, nodo);
                  else tarjetas.current.delete(post.id);
                }}
                post={post}
                prioridad={i === 0}
                rutaDeRegreso={rutaDeRegreso}
                className={
                  i >= VISIBLES_AL_CARGAR
                    ? // Alto estimado de una tarjeta 4:5 en movil; `auto` recuerda el real.
                      "[content-visibility:auto] [contain-intrinsic-size:auto_none_auto_640px]"
                    : undefined
                }
              />
            </li>
          ))}
        </ol>
      ) : null}

      {error ? <ErrorDeFormulario mensaje={error} /> : null}

      {cursor || sinPrimeraPagina ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void cargar()}
            // `aria-disabled` y no `disabled`: un boton deshabilitado con el foco
            // encima lo suelta al documento. `cargar` ya ignora el segundo clic.
            aria-disabled={cargando}
            aria-busy={cargando}
            className={botonSecundario}
          >
            {cargando
              ? "Cargando publicaciones"
              : sinPrimeraPagina
                ? "Reintentar"
                : "Cargar más"}
          </button>
        </div>
      ) : posts.length > 0 ? (
        <p role="status" className="text-center text-xs uppercase tracking-[0.15em] text-zinc-600">
          No hay más publicaciones
        </p>
      ) : null}
    </div>
  );
}
