"use client";

import { CircleUserRound, Images, MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const DESTINOS = [
  { href: "/feed", etiqueta: "Publicaciones", Icono: Images },
  { href: "/chats", etiqueta: "Mis chats", Icono: MessageCircle },
  { href: "/cuenta", etiqueta: "Mi cuenta", Icono: CircleUserRound },
] as const;

/** `/chats/<id>` sigue siendo "Mis chats"; `/feed` no tiene subrutas. */
function esActual(ruta: string, href: string): boolean {
  return ruta === href || ruta.startsWith(`${href}/`);
}

/**
 * Navegacion del area del cliente: publicaciones, chats y cuenta.
 *
 * En el telefono es una barra fija abajo, al alcance del pulgar, con su hueco
 * para el indicador de inicio (`safe-area-inset-bottom`). El cuerpo reserva su
 * alto mientras exista la barra (`[data-navegacion-cliente]` en `globals.css`),
 * asi que la pagina que la use no tiene que acordarse de dejar sitio. En
 * pantallas anchas pasa a una franja discreta arriba, pegada al borde al hacer
 * scroll: abajo, en un escritorio, queda lejos de todo.
 *
 * Va primero en el DOM para que el teclado y los lectores la encuentren antes
 * que el contenido; la posicion en pantalla la decide el CSS.
 *
 * No se usa dentro de una conversacion (`/chats/<id>`): esa pantalla ocupa el
 * alto completo con la barra de escritura al pie, y otra barra fija encima se
 * la taparia. Desde el chat se vuelve a la bandeja con la flecha de su cabecera.
 */
export default function NavegacionCliente() {
  const ruta = usePathname() ?? "";

  return (
    <nav
      aria-label="Área del cliente"
      data-navegacion-cliente=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800/80 bg-[#050505]/95 pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] backdrop-blur-md md:sticky md:top-0 md:bottom-auto md:border-b md:border-t-0 md:pb-0 md:pt-[env(safe-area-inset-top,0px)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-3 md:flex md:max-w-3xl md:justify-center md:gap-2">
        {DESTINOS.map(({ href, etiqueta, Icono }) => {
          const actual = esActual(ruta, href);
          return (
            <li key={href} className="flex">
              <Link
                href={href}
                aria-current={actual ? "page" : undefined}
                // El indicador de la pagina actual no es solo color: lleva una
                // raya (arriba en el telefono, abajo en escritorio) y peso. La
                // raya es un borde y no un fondo para que siga viendose con
                // colores forzados.
                className="relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-2 text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-400 transition-colors hover:text-[#E8D5A3] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#C5A55A] aria-[current=page]:font-bold aria-[current=page]:text-[#C5A55A] aria-[current=page]:before:absolute aria-[current=page]:before:inset-x-6 aria-[current=page]:before:top-0 aria-[current=page]:before:border-t-2 aria-[current=page]:before:border-[#C5A55A] md:min-h-12 md:w-auto md:flex-row md:gap-2 md:px-4 md:text-[11px] md:aria-[current=page]:before:top-auto md:aria-[current=page]:before:bottom-0 md:aria-[current=page]:before:inset-x-3"
              >
                <Icono aria-hidden="true" className="h-5 w-5 md:h-4 md:w-4" />
                {etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
