import { redirect } from "next/navigation";

import SelectorDeBandeja from "@/components/jefe/chats-web/SelectorDeBandeja";
import ColaDePublicaciones from "@/components/jefe/publicaciones/ColaDePublicaciones";
import { getCurrentUser } from "@/lib/auth";
import { getColaDePosts } from "@/lib/data/posts-del-equipo";
import { optionalSource } from "@/lib/optional-source";
import type { ColaDePosts } from "@/lib/posts-del-equipo";
import { inicioParaRol } from "@/lib/roles";

/**
 * Cola de publicaciones por revisar del jefe. Cuelga de "Hoy" junto a la
 * bandeja de chats y es la direccion a la que lleva el aviso
 * `post_pending`.
 */
export default async function PublicacionesJefePage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar");
  if (usuario.rol !== "jefe" && usuario.rol !== "admin") redirect(inicioParaRol(usuario.rol));

  const inicial = await optionalSource<ColaDePosts | null>(
    getColaDePosts(),
    null,
    "jefe/publicaciones",
  );

  return (
    <ColaDePublicaciones
      inicial={inicial ?? { items: [], nextCursor: null }}
      errorInicial={inicial === null}
      encabezado={<SelectorDeBandeja actual="publicaciones" />}
    />
  );
}
