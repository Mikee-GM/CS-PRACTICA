"use client";

import { useEffect, useRef, useState } from "react";

export type EventoDelChat = {
  type: string;
  data?: {
    conversationId?: string;
    messageId?: string;
    status?: string;
  };
};

export type EstadoDelCanal = "conectando" | "en-vivo" | "reconectando";

/**
 * Canal en vivo del cliente (`/api/realtime/sse?canal=cliente`).
 *
 * Mismo patron que `ActualizarEnVivo`: reconexion a los cinco segundos tras
 * cualquier error, y al volver a la pestaña se rehace si se cayo en segundo
 * plano. Se separa porque el chat no puede refrescar la pagina entera con cada
 * evento --uno de "escribiendo" llega a cada rato--: entrega el evento y que la
 * pantalla decida que pedir.
 *
 * `alVolver` se llama al recuperar el foco, que es cuando el canal pudo perder
 * eventos: la pantalla vuelve a pedir lo reciente.
 */
export function useCanalCliente(
  alEvento: (evento: EventoDelChat) => void,
  alVolver?: () => void,
): EstadoDelCanal {
  const [estado, setEstado] = useState<EstadoDelCanal>("conectando");
  // Las funciones cambian en cada render; el canal no debe reabrirse por eso.
  const alEventoRef = useRef(alEvento);
  const alVolverRef = useRef(alVolver);
  useEffect(() => {
    alEventoRef.current = alEvento;
    alVolverRef.current = alVolver;
  });

  useEffect(() => {
    let fuente: EventSource | null = null;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let cerrado = false;

    function conectar() {
      if (cerrado) return;
      fuente = new EventSource("/api/realtime/sse?canal=cliente", {
        withCredentials: true,
      });
      fuente.onopen = () => setEstado("en-vivo");
      fuente.onmessage = (evento) => {
        let payload: EventoDelChat;
        try {
          payload = JSON.parse(evento.data) as EventoDelChat;
        } catch {
          return;
        }
        // El latido solo mantiene viva la conexion.
        if (!payload || payload.type === "heartbeat") return;
        alEventoRef.current(payload);
      };
      fuente.onerror = () => {
        fuente?.close();
        fuente = null;
        setEstado("reconectando");
        // Sin reconexion, una caida de red deja la conversacion muda.
        reintento = setTimeout(conectar, 5000);
      };
    }

    function alRecuperarFoco() {
      if (document.visibilityState !== "visible") return;
      alVolverRef.current?.();
      if (!fuente) {
        if (reintento) clearTimeout(reintento);
        conectar();
      }
    }

    conectar();
    document.addEventListener("visibilitychange", alRecuperarFoco);
    return () => {
      cerrado = true;
      if (reintento) clearTimeout(reintento);
      fuente?.close();
      document.removeEventListener("visibilitychange", alRecuperarFoco);
    };
  }, []);

  return estado;
}
