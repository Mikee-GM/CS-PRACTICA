import { MapPin, Receipt } from "lucide-react";

import { ItemMensaje } from "@/components/chat/animaciones";
import ReproductorDeAudio from "@/components/chat/ReproductorDeAudio";

import {
  enlaceAlMapa,
  etiquetaDeRemitente,
  type MensajeParaElEquipo,
} from "@/lib/chats-del-equipo";
import { horaDelMensaje } from "@/lib/conversaciones";

/**
 * Un mensaje visto por el operador.
 *
 * Al reves que en el chat del cliente, aqui cada mensaje dice quien lo
 * escribio (IA, Jefe, Cliente, Sistema): el cliente ve lo del equipo como de la
 * modelo, pero quien atiende necesita saber si contesto la IA o una persona.
 * El cliente va a la izquierda y el lado de la modelo (IA o equipo) a la
 * derecha, como lo ve quien responde.
 */
export default function MensajeDelEquipo({
  mensaje,
  onVerImagen,
  animar = false,
}: {
  mensaje: MensajeParaElEquipo;
  onVerImagen: (imagen: { url: string; titulo: string }) => void;
  /** Solo lo que llega con la conversacion abierta entra con movimiento. */
  animar?: boolean;
}) {
  const hora = (
    <time dateTime={mensaje.createdAt} className="text-[10px] tabular-nums text-zinc-500">
      {horaDelMensaje(mensaje.createdAt)}
    </time>
  );
  const etiqueta = etiquetaDeRemitente(mensaje.sender);

  if (mensaje.sender === "sistema") {
    return (
      <ItemMensaje lado="centro" animar={animar} className="flex justify-center px-2">
        <div className="max-w-[92%] rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {etiqueta}
            <span className="sr-only">: </span>
          </p>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">
            {mensaje.body}
          </p>
          <div className="mt-1">{hora}</div>
        </div>
      </ItemMensaje>
    );
  }

  const cliente = mensaje.sender === "cliente";
  const jefe = mensaje.sender === "jefe";

  return (
    <ItemMensaje
      lado={cliente ? "izquierda" : "derecha"}
      animar={animar}
      className={`flex ${cliente ? "justify-start" : "justify-end"}`}
    >
      <div className={`flex max-w-[85%] flex-col ${cliente ? "items-start" : "items-end"}`}>
        <p
          className={`mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            jefe ? "text-[#D4AF37]" : cliente ? "text-zinc-400" : "text-[#8B7635]"
          }`}
        >
          {etiqueta}
          <span className="sr-only">: </span>
        </p>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed text-[#F5F5F5] ${
            cliente
              ? "rounded-bl-md border border-zinc-800 bg-[#0A0A0A]"
              : jefe
                ? "rounded-br-md border border-[#D4AF37]/50 bg-[#D4AF37]/15"
                : "rounded-br-md border border-[#C5A55A]/25 bg-[#C5A55A]/5"
          }`}
        >
          <Adjunto mensaje={mensaje} onVerImagen={onVerImagen} />
          {mensaje.body ? <p className="whitespace-pre-wrap break-words">{mensaje.body}</p> : null}
        </div>
        <div className="mt-1 px-1">{hora}</div>
      </div>
    </ItemMensaje>
  );
}

function Adjunto({
  mensaje,
  onVerImagen,
}: {
  mensaje: MensajeParaElEquipo;
  onVerImagen: (imagen: { url: string; titulo: string }) => void;
}) {
  const adjunto = mensaje.attachment;
  if (!adjunto) return null;

  if (adjunto.type === "ubicacion") {
    const mapa = enlaceAlMapa(adjunto);
    return (
      <div className="mb-1 space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#E8D5A3]">
          <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
          Ubicación compartida
        </p>
        {adjunto.address ? <p className="text-xs text-zinc-300">{adjunto.address}</p> : null}
        {mapa ? (
          <a
            href={mapa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-xs font-semibold text-[#C5A55A] underline underline-offset-4 hover:text-[#E8D5A3]"
          >
            Abrir en el mapa
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : (
          <p className="text-xs text-zinc-500">Sin coordenadas para mostrar en el mapa.</p>
        )}
      </div>
    );
  }

  if (adjunto.type === "audio" && adjunto.url) {
    return (
      <div className="mb-1">
        <ReproductorDeAudio url={adjunto.url} durationMs={adjunto.durationMs} />
      </div>
    );
  }

  const titulo =
    adjunto.type === "comprobante"
      ? "Comprobante de pago"
      : adjunto.type === "audio"
        ? "Nota de voz"
        : "Foto";
  if (!adjunto.url) {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#E8D5A3]">
        <Receipt aria-hidden="true" className="h-3.5 w-3.5" />
        {titulo} (no disponible)
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onVerImagen({ url: adjunto.url!, titulo })}
      className="mb-1 block w-full overflow-hidden rounded-lg border border-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={adjunto.url}
        alt={`${titulo}, ver en grande`}
        loading="lazy"
        className="max-h-64 w-full object-cover"
      />
    </button>
  );
}
