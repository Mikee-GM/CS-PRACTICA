"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  etiquetaDeEstado,
  momentoCorto,
  vistaPrevia,
  type ResumenDeConversacion,
} from "@/lib/conversaciones";
import AvatarModelo from "./AvatarModelo";
import { useCanalCliente } from "./useCanalCliente";

/**
 * Bandeja del cliente: una tarjeta por conversacion.
 *
 * Se refresca sola con el canal en vivo, pero solo con los eventos que cambian
 * lo que se ve aqui (un mensaje nuevo o un cambio de estado). "Escribiendo"
 * llega muy a menudo y no cambia ninguna tarjeta.
 */
export default function ListaChats({
  conversaciones,
}: {
  conversaciones: ResumenDeConversacion[];
}) {
  const router = useRouter();
  useCanalCliente(
    (evento) => {
      if (
        evento.type === "message_created" ||
        evento.type === "conversation_status_changed"
      ) {
        router.refresh();
      }
    },
    () => router.refresh(),
  );

  if (conversaciones.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 px-6 py-10 text-center">
        <p className="font-heading text-xl text-white">Aún no tienes chats</p>
        <p className="mt-2 text-sm text-zinc-400">
          Elige una modelo en el catálogo y toca “Chatear” para empezar.
        </p>
        <Link
          href="/#catalogo"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-[#C5A55A]/60 px-5 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black"
        >
          Ver el catálogo
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-900 overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-950/60">
      {conversaciones.map((c) => {
        const momento = c.lastMessage?.createdAt ?? c.lastMessageAt ?? c.createdAt;
        const cerrada = c.status === "cerrada";
        return (
          <li key={c.id}>
            <Link
              href={`/chats/${c.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-900/60 focus-visible:bg-zinc-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/60"
            >
              <AvatarModelo
                nombre={c.employee.nombreArtistico}
                fotoUrl={c.employee.fotoPerfilUrl}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-heading text-lg font-semibold text-white">
                    {c.employee.nombreArtistico}
                  </span>
                  <time
                    dateTime={momento}
                    className="shrink-0 text-[11px] text-zinc-500"
                  >
                    {momentoCorto(momento)}
                  </time>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-zinc-400">
                    {vistaPrevia(c)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      cerrada
                        ? "border-zinc-700 text-zinc-500"
                        : "border-[#C5A55A]/40 text-[#E8D5A3]"
                    }`}
                  >
                    {etiquetaDeEstado(c.status)}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
