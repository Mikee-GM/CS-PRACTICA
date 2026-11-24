import { motion } from "framer-motion";
import { MapPin, Receipt } from "lucide-react";

import {
  EstadoAnimado,
  ItemMensaje,
  SACUDIDA_DE_ERROR,
} from "@/components/chat/animaciones";

import {
  horaDelMensaje,
  type EstadoDelComprobante,
  type MensajeEnPantalla,
} from "@/lib/conversaciones";

/** Que paso con el comprobante, y si hay que hacer algo. */
const TEXTO_DEL_ANALISIS: Record<EstadoDelComprobante, string> = {
  recibido: "Comprobante recibido. El equipo confirmará la transferencia.",
  en_revision: "Comprobante en revisión por el equipo.",
  rechazado: "Comprobante no válido. Envía otro desde el botón de abajo.",
  error: "No pudimos revisar el comprobante. Vuelve a enviarlo.",
};

/**
 * Un mensaje del chat.
 *
 * Tres formas: el cliente a la derecha, la modelo a la izquierda y los avisos
 * del sistema centrados y neutros. Lo que escribe alguien del equipo (`jefe`)
 * se pinta igual que la IA, como la modelo: el cliente no distingue quien esta
 * detras del asistente.
 *
 * Cada burbuja lleva el nombre de quien habla en texto oculto: dentro del
 * registro en vivo, un lector de pantalla anuncia "Valeria: ..." en vez de una
 * frase suelta sin saber de quien es.
 */
export default function Burbuja({
  mensaje,
  nombreModelo,
  onReintentar,
  analisis,
  animar = false,
}: {
  mensaje: MensajeEnPantalla;
  nombreModelo: string;
  onReintentar?: (clientMessageId: string) => void;
  /** Resultado del analisis si es un comprobante y ya llego el evento. */
  analisis?: EstadoDelComprobante;
  /** Solo lo que llega o se envia con el chat abierto entra con movimiento. */
  animar?: boolean;
}) {
  const hora = (
    <time dateTime={mensaje.createdAt} className="text-[10px] text-zinc-500">
      {horaDelMensaje(mensaje.createdAt)}
    </time>
  );

  if (mensaje.sender === "sistema") {
    return (
      <ItemMensaje lado="centro" animar={animar} className="flex justify-center px-2">
        <div className="max-w-[92%] rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-center">
          <span className="sr-only">Aviso: </span>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">
            {mensaje.body}
          </p>
          <div className="mt-1">{hora}</div>
        </div>
      </ItemMensaje>
    );
  }

  const propio = mensaje.sender === "cliente";
  const fallo = mensaje.envio === "error";

  return (
    <ItemMensaje
      lado={propio ? "derecha" : "izquierda"}
      animar={animar}
      className={`flex ${propio ? "justify-end" : "justify-start"}`}
    >
      <div className={`flex max-w-[85%] flex-col ${propio ? "items-end" : "items-start"}`}>
        <motion.div
          animate={fallo ? SACUDIDA_DE_ERROR : { x: 0 }}
          transition={{ duration: 0.4 }}
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            propio
              ? "rounded-br-md border border-[#C5A55A]/40 bg-[#C5A55A]/15 text-[#F5F5F5]"
              : "rounded-bl-md border border-zinc-800 bg-[#0A0A0A] text-[#F5F5F5]"
          } ${fallo ? "border-red-500/60" : ""}`}
        >
          <span className="sr-only">{propio ? "Tú: " : `${nombreModelo}: `}</span>
          <Adjunto mensaje={mensaje} />
          {mensaje.body ? (
            <p className="whitespace-pre-wrap break-words">{mensaje.body}</p>
          ) : null}
          {analisis ? (
            <p
              className={`mt-1 text-xs ${
                analisis === "rechazado" || analisis === "error"
                  ? "text-red-400"
                  : "text-[#E8D5A3]"
              }`}
            >
              {TEXTO_DEL_ANALISIS[analisis]}
            </p>
          ) : null}
        </motion.div>
        <div className="mt-1 flex items-center gap-2 px-1">
          <EstadoAnimado
            clave={mensaje.envio === "enviando" ? "enviando" : fallo ? "error" : "hora"}
            className="flex items-center gap-2"
          >
            {mensaje.envio === "enviando" ? (
              <span className="text-[10px] text-zinc-500">Enviando</span>
            ) : fallo ? (
              <>
                <span className="text-[10px] font-medium text-red-400">No se envió</span>
                {onReintentar && mensaje.clientMessageId ? (
                  <button
                    type="button"
                    onClick={() => onReintentar(mensaje.clientMessageId!)}
                    className="min-h-11 rounded-lg px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#C5A55A] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
                  >
                    Reintentar
                  </button>
                ) : null}
              </>
            ) : (
              hora
            )}
          </EstadoAnimado>
        </div>
      </div>
    </ItemMensaje>
  );
}

function Adjunto({ mensaje }: { mensaje: MensajeEnPantalla }) {
  const adjunto = mensaje.attachment;
  if (!adjunto) return null;

  if (adjunto.type === "ubicacion") {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#E8D5A3]">
        <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
        Ubicación compartida
      </p>
    );
  }

  const etiqueta = adjunto.type === "comprobante" ? "Comprobante de pago" : "Foto";
  if (!adjunto.url) {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#E8D5A3]">
        <Receipt aria-hidden="true" className="h-3.5 w-3.5" />
        {etiqueta}
      </p>
    );
  }

  return (
    <a
      href={adjunto.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 block overflow-hidden rounded-lg border border-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
    >
      {/*
       * `img` y no `next/image`: la URL la firma el backend al vuelo y su
       * dominio no tiene por que estar en `remotePatterns`; pasarla por el
       * optimizador tambien la dejaria cacheada mas alla de su caducidad.
       */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={adjunto.url}
        alt={`${etiqueta}, abrir en grande`}
        loading="lazy"
        className="max-h-64 w-full object-cover"
      />
    </a>
  );
}
