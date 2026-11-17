import { apiFetch, ApiError } from "@/lib/api-server";
import { isRedirectError } from "@/lib/auth";
import {
  falloDelFeed,
  LIMITE_POR_DEFECTO_DEL_FEED,
  loginConRegreso,
  paginaDelFeed,
  rutaDelPerfil,
  type LecturaDelFeed,
} from "@/lib/posts";

/*
 * Lecturas del feed en el servidor: la primera pagina del feed general y la de
 * una modelo. Las siguientes las pide `ListaPosts` desde el navegador.
 *
 * No lanzan salvo por redireccion. Un 403 (sin declaracion 18+) o un 404 no son
 * caidas, son respuestas que la pantalla explica, asi que vuelven como
 * `LecturaDelFeed`; `optionalSource` no sirve aqui porque las aplanaria todas en
 * un mismo valor por defecto. Las redirecciones de `apiFetch` (sesion caducada)
 * si se reemiten, igual que hace `optionalSource`.
 */

async function leer(
  ruta: string,
  { perfil, regreso }: { perfil: boolean; regreso: string },
): Promise<LecturaDelFeed> {
  try {
    const pagina = await apiFetch<unknown>(ruta, {
      // Sin sesion vuelve al login de cliente y, al entrar, a esta pantalla.
      loginPath: loginConRegreso(regreso),
    });
    return { estado: "ok", pagina: paginaDelFeed(pagina) };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof ApiError) return falloDelFeed(error.status, { perfil });
    console.error(`Fuente no disponible en feed (${ruta}):`, error);
    return falloDelFeed(null, { perfil });
  }
}

/** El mismo tamaño que las paginas que pide `ListaPosts` despues. */
const PRIMERA_PAGINA = `limit=${LIMITE_POR_DEFECTO_DEL_FEED}`;

/** Primera pagina del feed general del cliente. */
export function getFeed(): Promise<LecturaDelFeed> {
  return leer(`/feed?${PRIMERA_PAGINA}`, { perfil: false, regreso: "/feed" });
}

/** Primera pagina de las publicaciones de una modelo, por su slug del catalogo. */
export function getFeedDeModelo(slug: string): Promise<LecturaDelFeed> {
  return leer(`/feed/models/${encodeURIComponent(slug)}?${PRIMERA_PAGINA}`, {
    perfil: true,
    regreso: rutaDelPerfil(slug),
  });
}
