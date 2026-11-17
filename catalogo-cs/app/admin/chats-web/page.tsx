import { redirect } from "next/navigation";

import BandejaChatsWeb from "@/components/jefe/chats-web/BandejaChatsWeb";
import PageHeader from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/auth";
import type { ConversacionDelEquipo } from "@/lib/chats-del-equipo";
import { getConversacionesDelEquipo } from "@/lib/data/chats-del-equipo";
import { optionalSource } from "@/lib/optional-source";
import { inicioParaRol } from "@/lib/roles";

/**
 * La misma bandeja que el jefe, para el admin: ve todas las conversaciones y
 * puede forzar la toma de una que lleve otra persona.
 */
export default async function ChatsWebAdminPage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/admin");
  // El middleware ya solo deja entrar al admin en `/admin`; esto lo confirma.
  if (usuario.rol !== "admin") redirect(inicioParaRol(usuario.rol));

  const inicial = await optionalSource<ConversacionDelEquipo[] | null>(
    getConversacionesDelEquipo(),
    null,
    "admin/chats-web",
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Chats web"
        description="Conversaciones del chat web con los clientes: quién las atiende, qué necesita revisión y las solicitudes por aceptar."
      />
      <BandejaChatsWeb
        usuario={{ id: usuario.id, rol: usuario.rol }}
        inicial={inicial ?? []}
        errorInicial={inicial === null}
        className="h-[calc(100dvh-14rem-env(safe-area-inset-top))] min-h-[520px]"
      />
    </div>
  );
}
