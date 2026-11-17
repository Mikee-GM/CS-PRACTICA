"use server";

import { getCurrentUser, isRedirectError } from "@/lib/auth";
import { getFeedDeModelo } from "@/lib/data/posts";
import type { PublicacionesDelPerfil } from "@/lib/posts";
import { inicioParaRol } from "@/lib/roles";

/**
 * Sesion de quien mira el perfil de una modelo y, si es un cliente, la primera
 * pagina de sus publicaciones.
 *
 * El perfil se prerenderiza (ISR) para todos, asi que el render no puede saber
 * quien lo mira; esto lo pregunta despues de montar, en una sola ida. Al
 * personal no se le piden los posts: el backend se los negaria con un 403 que
 * se leeria, mal, como una cuenta sin declaracion 18+.
 *
 * Una redireccion de `apiFetch` (la sesion caduco entre `/auth/me` y el feed)
 * NO se reemite: dentro de una accion sacaria a la persona del perfil publico,
 * que sin sesion tambien se puede ver. Se contesta como si no hubiera sesion y
 * la pantalla ofrece entrar.
 */
export async function publicacionesDelPerfilAction(
  slug: string,
): Promise<PublicacionesDelPerfil> {
  const usuario = await getCurrentUser();
  if (!usuario) return { sesion: "ninguna" };
  if (usuario.rol !== "cliente") {
    return { sesion: "personal", inicio: inicioParaRol(usuario.rol) };
  }
  try {
    return { sesion: "cliente", lectura: await getFeedDeModelo(slug) };
  } catch (error) {
    if (isRedirectError(error)) return { sesion: "ninguna" };
    throw error;
  }
}
