import { redirect } from "next/navigation";

import BandejaChatsWeb from "@/components/jefe/chats-web/BandejaChatsWeb";
import SelectorDeBandeja from "@/components/jefe/chats-web/SelectorDeBandeja";
import { getCurrentUser } from "@/lib/auth";
import type { ConversacionDelEquipo } from "@/lib/chats-del-equipo";
import { getConversacionesDelEquipo } from "@/lib/data/chats-del-equipo";
import { optionalSource } from "@/lib/optional-source";
import { inicioParaRol } from "@/lib/roles";

/**
 * Chats web vistos por el jefe. Hermana de "Hoy" (`/jefe`), que es la bandeja
 * de Telegram: comparten la entrada "Hoy" de la barra y se cambia entre las dos
 * con el selector de arriba de la lista.
 */
export default async function ChatsWebJefePage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/admin");
  if (usuario.rol !== "jefe" && usuario.rol !== "admin") redirect(inicioParaRol(usuario.rol));

  const inicial = await optionalSource<ConversacionDelEquipo[] | null>(
    getConversacionesDelEquipo(),
    null,
    "jefe/chats-web",
  );

  return (
    <BandejaChatsWeb
      usuario={{ id: usuario.id, rol: usuario.rol }}
      inicial={inicial ?? []}
      errorInicial={inicial === null}
      encabezado={<SelectorDeBandeja actual="web" />}
      // Lo que deja la cabecera movil, la barra inferior y el relleno del panel.
      className="h-[calc(100dvh-8.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-2rem)] lg:min-h-[620px]"
    />
  );
}
