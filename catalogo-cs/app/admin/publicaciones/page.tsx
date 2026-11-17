import { redirect } from "next/navigation";

import ColaDePublicaciones from "@/components/jefe/publicaciones/ColaDePublicaciones";
import PageHeader from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/auth";
import { getColaDePosts } from "@/lib/data/posts-del-equipo";
import { optionalSource } from "@/lib/optional-source";
import type { ColaDePosts } from "@/lib/posts-del-equipo";
import { inicioParaRol } from "@/lib/roles";

/**
 * La misma cola que el jefe, para el admin: ve las publicaciones de todas las
 * modelos.
 */
export default async function PublicacionesAdminPage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar");
  // El middleware ya solo deja entrar al admin en `/admin`; esto lo confirma.
  if (usuario.rol !== "admin") redirect(inicioParaRol(usuario.rol));

  const inicial = await optionalSource<ColaDePosts | null>(
    getColaDePosts(),
    null,
    "admin/publicaciones",
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Publicaciones"
        description="Publicaciones del feed por revisar: revisa cada foto y cada video completo antes de aprobar."
      />
      <ColaDePublicaciones
        inicial={inicial ?? { items: [], nextCursor: null }}
        errorInicial={inicial === null}
        // El panel de admin no tiene barra inferior: las acciones se pegan al borde.
        barraClassName="bottom-[max(1rem,env(safe-area-inset-bottom))]"
      />
    </div>
  );
}
