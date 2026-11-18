import { redirect } from "next/navigation";

import BandejaChatsWeb from "@/components/jefe/chats-web/BandejaChatsWeb";
import SelectorDeBandeja from "@/components/jefe/chats-web/SelectorDeBandeja";
import TodayHeader from "@/components/jefe/today/TodayHeader";
import { getJefeEmployees } from "@/lib/actions/jefe-panel";
import { getMyWorkShift } from "@/lib/actions/work-shift";
import { getCurrentUser } from "@/lib/auth";
import type { ConversacionDelEquipo } from "@/lib/chats-del-equipo";
import { getConversacionesDelEquipo } from "@/lib/data/chats-del-equipo";
import { optionalSource } from "@/lib/optional-source";
import { inicioParaRol } from "@/lib/roles";
import type { Employee } from "@/lib/types";

interface PageProps {
  /** Compatibilidad con enlaces existentes de solicitudes grupales. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * "Hoy" del jefe: la bandeja de chats web con el interruptor de jornada y
 * "Crear servicio" encima. Es el destino de los avisos que apuntan a `/jefe`.
 */
export default async function JefePage({ searchParams }: PageProps) {
  const { tab } = await searchParams;
  if (tab === "grupos") redirect("/jefe/grupos");

  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar");
  if (usuario.rol !== "jefe" && usuario.rol !== "admin") redirect(inicioParaRol(usuario.rol));

  const [inicial, workShift, employees] = await Promise.all([
    optionalSource<ConversacionDelEquipo[] | null>(
      getConversacionesDelEquipo(),
      null,
      "jefe",
    ),
    optionalSource(getMyWorkShift(), null, "jefe/jornada"),
    // getJefeEmployees solo admite rol jefe; un admin no tiene equipo propio.
    usuario.rol === "jefe"
      ? optionalSource<Employee[]>(getJefeEmployees(), [], "jefe/equipo")
      : Promise.resolve<Employee[]>([]),
  ]);

  return (
    <>
      <TodayHeader workShift={workShift} employees={employees} />
      <BandejaChatsWeb
        usuario={{ id: usuario.id, rol: usuario.rol }}
        inicial={inicial ?? []}
        errorInicial={inicial === null}
        encabezado={<SelectorDeBandeja actual="chats" />}
        // Lo que dejan la cabecera movil, el encabezado de Hoy, la barra inferior y el relleno.
        className="h-[calc(100dvh-13rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-6rem)] lg:min-h-[560px]"
      />
    </>
  );
}
