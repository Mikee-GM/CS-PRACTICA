import type { Metadata } from "next";
import { getDriverPortalData } from "@/lib/actions/driver-portal";
import DriverPortalView from "@/components/chofer/DriverPortalView";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMyWorkShift } from "@/lib/actions/work-shift";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "Mi Portal -- Colombia Sexys",
  description: "Portal exclusivo para choferes de Colombia Sexys.",
  robots: "noindex, nofollow",
  /*
   * El portal se instala en la pantalla de inicio, y de ahi sale la sesion
   * que traen los avisos push: dentro del webview de Telegram no existe el
   * service worker que hacen falta, solo en la aplicacion instalada. En
   * iPhone, ademas, `appleWebApp` no es un adorno: sin el, lo que se anade
   * a la pantalla de inicio abre como una pestaña normal y no llega nada.
   */
  manifest: "/manifest-chofer.webmanifest",
  appleWebApp: { capable: true, title: "Portal CS", statusBarStyle: "black-translucent" },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function DriverPortalPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const result = await getDriverPortalData(token);

  /* Solo con sesion: un enlace antiguo con token no lleva cookie. */
  const sesion = await getCurrentUser();

  /*
   * Sin sesion y sin token no hay nada que mostrar, y la pantalla de "acceso no
   * disponible" era un callejon sin salida: obligaba a volver a Telegram a
   * pedir un enlace nuevo. Ahora se manda al login, donde puede entrar con su
   * correo y su contraseña. Es lo que hace que la aplicacion instalada se
   * arregle sola cuando caduca la sesion.
   */
  if (!sesion && !token) {
    redirect("/ingresar");
  }
  /*
   * Un enlace con token que ya no vale, sin sesion propia: tambien al login.
   * Antes se quedaba en una pantalla que mandaba a pedir otro enlace al bot.
   */
  if (!sesion && (!result.success || !result.data)) {
    redirect("/ingresar");
  }
  const workShift = sesion ? await getMyWorkShift() : null;

  if (!result.success || !result.data) {
    return (
      <div className="min-h-screen bg-[#0d0f12] text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
          <AlertTriangle size={28} />
        </div>
        {/* Aqui solo se llega con sesion: es un fallo al cargar, no de acceso. */}
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

  return <DriverPortalView initialData={result.data} workShift={workShift} />;
}
