import type { Metadata } from "next";
import { getDriverPortalData } from "@/lib/actions/driver-portal";
import DriverPortalView from "@/components/chofer/DriverPortalView";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { inicioParaRol } from "@/lib/roles";
import { getMyWorkShift } from "@/lib/actions/work-shift";
import { obtenerMisRetos } from "@/lib/actions/retos-del-personal";
import { optionalSource } from "@/lib/optional-source";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "Mi Portal -- Colombia Sexys",
  description: "Portal exclusivo para choferes de Colombia Sexys.",
  robots: "noindex, nofollow",
  /*
   * El portal se instala en la pantalla de inicio, y de ahi sale la sesion
   * que traen los avisos push: los avisos push solo llegan a la aplicacion instalada. En
   * iPhone, ademas, `appleWebApp` no es un adorno: sin el, lo que se anade
   * a la pantalla de inicio abre como una pestaña normal y no llega nada.
   */
  manifest: "/manifest-chofer.webmanifest",
  appleWebApp: { capable: true, title: "Portal CS", statusBarStyle: "black-translucent" },
};

interface PageProps {
  searchParams: Promise<{ seccion?: string }>;
}

/** Pestañas a las que puede apuntar un enlace. Nada mas abre el portal por defecto. */
const SECCIONES = ["resumen", "ranking", "viajes", "reputacion", "retos"] as const;
type Seccion = (typeof SECCIONES)[number];

export default async function DriverPortalPage({ searchParams }: PageProps) {
  const { seccion } = await searchParams;

  // Solo con sesion web: sin ella, al login; con otro rol, a su propio inicio.
  const sesion = await getCurrentUser();
  if (!sesion) redirect("/ingresar");
  if (sesion.rol !== "chofer") redirect(inicioParaRol(sesion.rol));

  // La jornada y los retos no dependen del portal: van en paralelo con el.
  const [result, workShift, retos] = await Promise.all([
    getDriverPortalData(),
    getMyWorkShift(),
    optionalSource(obtenerMisRetos(), [], "portal del chofer"),
  ]);

  if (!result.success || !result.data) {
    return (
      <div className="min-h-screen bg-[#0d0f12] text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
          <AlertTriangle size={28} />
        </div>
        {/* Es un fallo al cargar, no de acceso: la sesion ya se comprobo. */}
        <h1 className="font-heading text-2xl font-semibold text-red-400 mb-2">
          No se pudo cargar tu portal
        </h1>
        <p className="text-sm text-gray-400 max-w-md mb-6">
          {result.error ||
            "Vuelve a intentarlo en unos minutos. Si el problema continúa, cierra sesión y vuelve a entrar."}
        </p>
        <Link
          href="/chofer/portal"
          className="inline-flex min-h-11 items-center rounded-xl border border-[#C5A55A]/70 px-5 text-xs font-semibold uppercase tracking-[0.14em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black"
        >
          Volver a intentar
        </Link>
      </div>
    );
  }

  const seccionInicial: Seccion = SECCIONES.includes(seccion as Seccion)
    ? (seccion as Seccion)
    : "resumen";

  return (
    <DriverPortalView
      initialData={result.data}
      workShift={workShift}
      retos={retos}
      seccionInicial={seccionInicial}
    />
  );
}
