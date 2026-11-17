import Link from "next/link";

const BANDEJAS = [
  { clave: "telegram", href: "/jefe", etiqueta: "Telegram" },
  { clave: "web", href: "/jefe/chats-web", etiqueta: "Chats web" },
  { clave: "publicaciones", href: "/jefe/publicaciones", etiqueta: "Publicaciones" },
] as const;

/**
 * Cambia entre las bandejas de "Hoy": Telegram, chat web y la cola de
 * publicaciones por revisar.
 *
 * Son dos pantallas con su propia direccion, no pestañas dentro de una: cada
 * una carga sus datos y su canal, y asi el boton atras y un enlace guardado
 * llevan a la bandeja correcta. Por eso es navegacion con `aria-current` y no
 * `role="tablist"`.
 */
export default function SelectorDeBandeja({
  actual,
}: {
  actual: (typeof BANDEJAS)[number]["clave"];
}) {
  return (
    <nav aria-label="Bandejas de Hoy">
      <ul className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
        {BANDEJAS.map(({ clave, href, etiqueta }) => {
          const activa = clave === actual;
          return (
            <li key={clave} className="flex-1">
              <Link
                href={href}
                aria-current={activa ? "page" : undefined}
                // Con tres entradas, en mayusculas espaciadas "Publicaciones" no
                // cabe en un tercio de un telefono de 360 px; ahi va en tipo normal.
                className={`flex min-h-11 items-center justify-center rounded-lg px-1.5 text-[11px] font-semibold transition-colors sm:px-3 sm:uppercase sm:tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 ${
                  activa
                    ? "bg-[#C5A55A] text-black"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-[#E8D5A3]"
                }`}
              >
                {etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
