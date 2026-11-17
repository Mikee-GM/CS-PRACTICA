import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import {
  etiquetaDeEstado,
  type EstadoConversacion,
  type ModeloDelChat,
} from "@/lib/conversaciones";
import AvatarModelo from "./AvatarModelo";
import type { EstadoDelCanal } from "./useCanalCliente";

/**
 * Cabecera fija del chat: quien contesta y en que estado esta la conversacion.
 *
 * La leyenda "Asistente virtual de ..." va siempre, conteste la IA o alguien
 * del equipo: el cliente habla con la modelo a traves de su asistente, y que
 * cambie quien escribe por detras no es algo que deba notar ni decidir.
 */
export default function EncabezadoAsistente({
  modelo,
  status,
  canal,
}: {
  modelo: ModeloDelChat;
  status: EstadoConversacion;
  canal: EstadoDelCanal;
}) {
  return (
    <header className="shrink-0 border-b border-zinc-800/80 bg-[#050505]/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-2 py-2 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <Link
          href="/chats"
          aria-label="Volver a mis chats"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
        >
          <ChevronLeft aria-hidden="true" className="h-6 w-6" />
        </Link>
        <AvatarModelo
          nombre={modelo.nombreArtistico}
          fotoUrl={modelo.fotoPerfilUrl}
          tamano={44}
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-xl font-semibold leading-tight text-white">
            {modelo.nombreArtistico}
          </h1>
          <p className="truncate text-[11px] text-zinc-400">
            Asistente virtual de {modelo.nombreArtistico}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              status === "cerrada"
                ? "border-zinc-700 text-zinc-500"
                : "border-[#C5A55A]/40 text-[#E8D5A3]"
            }`}
          >
            {etiquetaDeEstado(status)}
          </span>
          {/*
           * Solo se anuncia la perdida de conexion. "Conectando" al entrar no
           * le dice nada util a nadie y robaria la primera lectura.
           */}
          <span role="status" className="text-[10px] text-zinc-500">
            {canal === "reconectando" ? "Reconectando" : null}
          </span>
        </div>
      </div>
    </header>
  );
}
