"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, ClipboardList, FileWarning, LayoutGrid, LogOut, MapPinned, ShieldCheck, Trophy } from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import SessionKeeper from "@/components/auth/session-keeper";
import ComprobarVersion from "@/components/ui/ComprobarVersion";
import { broadcastLogout } from "@/lib/client-session";
import { usePendientesDePublicaciones } from "@/components/jefe/publicaciones/usePendientesDePublicaciones";
import { textoCortoDelContador, textoDelContador } from "@/lib/posts-del-equipo";

// `corto` es la etiqueta de la barra inferior del movil. Con el texto largo,
// "Registros a mano" no cabe en una columna de 78px y parte en dos lineas, que
// era lo que descuadraba la altura de toda la barra.
const links = [
  /*
   * "Hoy" y no "Equipo": el equipo es una de las vistas de DENTRO de esta
   * pantalla, y tener la misma palabra para la seccion y para una de sus
   * pestañas obligaba a mirar dos veces para saber donde estabas.
   */
  { href: "/jefe", label: "Hoy", corto: "Hoy", icon: LayoutGrid },
  { href: "/jefe/servicios", label: "Servicios activos", corto: "Servicios", icon: BriefcaseBusiness },
  { href: "/jefe/mapa", label: "Mapa", corto: "Mapa", icon: MapPinned },
  { href: "/jefe/reportes", label: "Reportes", corto: "Reportes", icon: FileWarning },
  { href: "/jefe/servicios-manuales", label: "Registros a mano", corto: "Registros", icon: ClipboardList },
  { href: "/jefe/retos", label: "Retos", corto: "Retos", icon: Trophy },
];

/*
 * Los chats web son la otra bandeja de "Hoy": comparten su entrada en la barra
 * y su marco a pantalla completa en vez de ocupar una septima celda.
 */
const BANDEJAS_DE_HOY = new Set(["/jefe", "/jefe/chats-web"]);

/*
 * La cola de publicaciones tambien cuelga de "Hoy": es trabajo por atender, se
 * llega a ella desde el selector de arriba de las bandejas y los avisos de
 * `post_pending` abren directo su direccion. A diferencia de los chats, usa el
 * marco normal con scroll de pagina, asi que no entra en `BANDEJAS_DE_HOY`.
 */
const SECCIONES_DE_HOY = new Set([...BANDEJAS_DE_HOY, "/jefe/publicaciones"]);

function esActivo(href: string, pathname: string | null): boolean {
  return href === "/jefe" ? SECCIONES_DE_HOY.has(pathname ?? "") : pathname === href;
}

export default function JefeLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Las publicaciones por revisar se anuncian en "Hoy", que es donde viven.
  const pendientes = usePendientesDePublicaciones(pathname);
  const conPendientes = pendientes !== null && pendientes.cantidad > 0;

  async function signOut() {
    await logoutAction();
    broadcastLogout();
    router.replace("/ingresar");
  }

  /*
   * `min-h-dvh` en vez de `min-h-screen`.
   *
   * `min-h-screen` son 100vh, que en iOS miden la ventana CON la barra del
   * navegador retraida y no cambian al mostrarse u ocultarse. La pagina queda
   * entonces mas alta que lo que de verdad se ve, y la barra inferior --que se
   * posiciona contra ese viewport-- aparece flotando por encima del borde en
   * vez de pegada abajo: es el "de la nada se sube". La unidad dinamica sigue
   * al viewport real.
   */
  return (
    <div className="min-h-dvh bg-black font-body text-white lg:flex">
      <SessionKeeper />
      {/* El panel tambien se instala en el telefono, y alli una version vieja
          puede quedarse cargada dias. */}
      <ComprobarVersion />
      {/* Ver la nota del panel de admin: en tableta instalada la barra de
          estado se pinta encima del menu lateral. */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-[#050505] pt-[env(safe-area-inset-top)] lg:flex lg:flex-col">
        <div className="border-b border-zinc-800 p-7">
          <Image src="/logo-horizontal.webp" alt="Colombia Sexys" width={190} height={70} className="h-auto w-full" />
          <div className="mt-5 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C5A55A]">
            <ShieldCheck size={14} /> Panel de jefe
          </div>
        </div>
        <nav className="flex-1 space-y-2 p-4">
          {links.map(({ href, label, icon: Icon }) => {
            const active = esActivo(href, pathname);
            return (
              <Link key={href} href={href} className={`flex items-center gap-3 px-4 py-4 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${active ? "bg-[#C5A55A] text-black" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"}`}>
                <Icon size={17} /> {label}
                {href === "/jefe" && conPendientes ? (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] tabular-nums tracking-normal ${active ? "bg-black text-[#E8D5A3]" : "bg-[#C5A55A] text-black"}`}>
                    <span aria-hidden="true">{textoCortoDelContador(pendientes)}</span>
                    <span className="sr-only">{textoDelContador(pendientes)}</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <button onClick={signOut} className="m-4 flex items-center justify-center gap-2 border border-[#C5A55A]/50 px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black">
          <LogOut size={15} /> Cerrar sesión
        </button>
      </aside>
      {/*
        El hueco que deja el contenido para la barra tiene que incluir el
        indicador de inicio del iPhone. Con `pb-28` a secas, ahora que
        `env(safe-area-inset-bottom)` si tiene valor, la barra crece y volvia a
        tapar el final de la pagina.
      */}
      <div className="min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
        {/* En movil no habia ni marca ni salida fuera de la barra inferior.
            Esta cabecera da sitio a las dos y libera la sexta celda. */}
        {/* El relleno de arriba suma la barra de estado del telefono: sin
            el, con la app instalada, el logo y Cerrar sesion quedaban
            debajo de la hora del sistema y no se podian pulsar. */}
        <header className="flex items-center justify-between border-b border-zinc-800 bg-[#050505] px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] lg:hidden">
          <Image src="/logo-horizontal.webp" alt="Colombia Sexys" width={140} height={52} className="h-7 w-auto" />
          <button onClick={signOut} aria-label="Cerrar sesión" className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 transition-colors hover:border-[#C5A55A] hover:text-[#C5A55A]">
            <LogOut size={18} />
          </button>
        </header>
        <main
          className={
            BANDEJAS_DE_HOY.has(pathname ?? "")
              ? "w-full max-w-none p-2 sm:p-3 lg:p-4"
              : "mx-auto max-w-7xl p-4 sm:p-6 lg:p-10"
          }
        >
          {children}
        </main>
      </div>
      {/* Los seis destinos son acciones reales. Se mantienen en una sola fila
          con etiquetas cortas; Cerrar sesión permanece en la cabecera. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 gap-0.5 border-t border-zinc-800 bg-[#050505]/95 px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {links.map(({ href, corto, icon: Icon }) => (
          <Link key={href} href={href} className={`flex h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[9px] font-semibold ${esActivo(href, pathname) ? "bg-[#C5A55A]/10 text-[#C5A55A]" : "text-zinc-500"}`}>
            {/* La insignia va absoluta sobre el icono: no cambia el alto de la
                celda ni empuja la etiqueta. */}
            <span className="relative">
              <Icon size={19} />
              {href === "/jefe" && conPendientes ? (
                <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-[#C5A55A] px-1 text-center text-[9px] leading-4 tabular-nums text-black">
                  <span aria-hidden="true">{textoCortoDelContador(pendientes)}</span>
                  <span className="sr-only">{textoDelContador(pendientes)}</span>
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{corto}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
