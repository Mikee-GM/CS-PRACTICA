import { Bot, UserRound } from "lucide-react";

import {
  etiquetaDeMotivo,
  textoDeControl,
  vistaPreviaDelEquipo,
  type ConversacionDelEquipo,
  type UsuarioDelPanel,
} from "@/lib/chats-del-equipo";
import { etiquetaDeEstado, momentoCorto } from "@/lib/conversaciones";

/**
 * Una conversacion en la bandeja: cliente y modelo, quien la lleva, el ultimo
 * mensaje y por que pide atencion. Los motivos van en texto y no solo como un
 * punto de color: el color solo no le dice nada a un lector de pantalla ni a
 * quien no distingue el ambar.
 */
export default function FilaChatWeb({
  conversacion,
  usuario,
  seleccionada,
  onAbrir,
}: {
  conversacion: ConversacionDelEquipo;
  usuario: UsuarioDelPanel;
  seleccionada: boolean;
  onAbrir: () => void;
}) {
  const momento = conversacion.lastMessageAt ?? conversacion.createdAt;
  const ia = conversacion.mode === "AI_ACTIVE";

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-current={seleccionada ? "true" : undefined}
        className={`flex w-full flex-col gap-1.5 border-b border-zinc-900 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/60 ${
          seleccionada ? "bg-[#C5A55A]/10" : "hover:bg-zinc-950"
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-white">
            {conversacion.requiereAtencion ? (
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#D4AF37] align-middle"
              />
            ) : null}
            {conversacion.client.nombre}
            <span className="font-normal text-zinc-500"> con </span>
            {conversacion.employee.nombreArtistico}
          </span>
          <time dateTime={momento} className="shrink-0 text-[10px] tabular-nums text-zinc-500">
            {momentoCorto(momento)}
          </time>
        </span>

        <span className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
          {vistaPreviaDelEquipo(conversacion)}
        </span>

        <span className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
              ia
                ? "border-zinc-800 text-zinc-400"
                : "border-[#C5A55A]/50 text-[#E8D5A3]"
            }`}
          >
            {ia ? (
              <Bot aria-hidden="true" className="h-3 w-3" />
            ) : (
              <UserRound aria-hidden="true" className="h-3 w-3" />
            )}
            {textoDeControl(conversacion, usuario)}
          </span>
          <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-500">
            {etiquetaDeEstado(conversacion.status)}
          </span>
          {conversacion.requiereAtencion ? <span className="sr-only">Requiere atención: </span> : null}
          {conversacion.motivosDeAtencion.map((motivo) => (
            <span
              key={motivo}
              className="rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-2 py-0.5 text-[#E8D5A3]"
            >
              {etiquetaDeMotivo(motivo)}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
