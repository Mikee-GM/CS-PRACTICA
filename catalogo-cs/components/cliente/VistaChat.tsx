"use client";

import { nuevoId } from "@/lib/nuevo-id";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { enviarMediaAction, enviarMensajeAction } from "@/lib/actions/conversaciones";
import { errorDeMedia, type MediaParaEnviar } from "@/lib/media-del-chat";
import { pedirConSesion } from "@/lib/client-fetch";
import {
  crearOptimista,
  cursorMasAntiguo,
  debeMostrarComprobante,
  enlazaConLoConocido,
  esOptimista,
  estaEscribiendo,
  marcarEnvio,
  mezclarMensajes,
  ESTADOS_DEL_COMPROBANTE,
  type EstadoConversacion,
  type EstadoDelComprobante,
  type MensajeDelChat,
  type MensajeEnPantalla,
  type PaginaDeMensajes,
  type ResumenDeConversacion,
  type UbicacionDelMensaje,
} from "@/lib/conversaciones";
import { esRedireccion } from "@/lib/es-redireccion";
import { useAreaVisible } from "@/components/chat/useAreaVisible";
import BarraEscritura from "./BarraEscritura";
import Burbuja from "./Burbuja";
import { ErrorDeFormulario } from "./Campo";
import { IndicadorEscribiendo } from "@/components/chat/animaciones";
import EncabezadoAsistente from "./EncabezadoAsistente";
import SubirComprobante from "./SubirComprobante";
import ValorarServicio from "./ValorarServicio";
import { useCanalCliente, type EventoDelChat } from "./useCanalCliente";

const ESTADOS: readonly EstadoConversacion[] = ["activa", "en_revision", "con_servicio", "cerrada"];

/**
 * Cuanto dura "escribiendo" sin otro aviso. El backend ya manda el fin
 * (`activo: false`); esto queda de respaldo por si ese evento se pierde.
 */
const DURACION_ESCRIBIENDO_MS = 10_000;

/** Paginas como maximo al rellenar un hueco tras una caida del canal. */
const MAXIMO_PAGINAS_HUECO = 5;

/** A menos de esto del final se sigue pegado al ultimo mensaje. */
const CERCA_DEL_FINAL_PX = 120;

function movimientoReducido(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Conversacion del cliente con el asistente de una modelo.
 *
 * Los mensajes llegan por tres caminos y se funden con `mezclarMensajes`: la
 * primera pagina que trae el servidor, las paginas antiguas que se piden hacia
 * arriba y lo que el canal en vivo avisa. Los avisos solo traen ids, asi que
 * cada uno se convierte en una peticion de "lo mas reciente".
 *
 * Accesibilidad del registro: lo que ya estaba al abrir y lo que se carga hacia
 * atras va en una lista sin anuncios; solo lo que llega despues entra en el
 * `role="log"`. Si todo viviera en el registro, cargar una pagina antigua haria
 * que el lector de pantalla leyera treinta mensajes viejos de golpe.
 */
export default function VistaChat({
  conversacion,
  paginaInicial,
  errorInicial,
}: {
  conversacion: ResumenDeConversacion;
  paginaInicial: PaginaDeMensajes;
  errorInicial: boolean;
}) {
  const conversationId = conversacion.id;
  const nombre = conversacion.employee.nombreArtistico;

  const [mensajes, setMensajes] = useState<MensajeEnPantalla[]>(() =>
    mezclarMensajes([], paginaInicial.items),
  );
  // Ids que forman el historial (sin anuncio). Lo que no este aqui es nuevo.
  const [historial, setHistorial] = useState<ReadonlySet<string>>(
    () => new Set(paginaInicial.items.map((m) => m.id)),
  );
  const [cursor, setCursor] = useState<string | null>(paginaInicial.nextCursor);
  const [status, setStatus] = useState<EstadoConversacion>(conversacion.status);
  const [escribiendo, setEscribiendo] = useState(false);
  const [cargandoAntiguos, setCargandoAntiguos] = useState(false);
  const [errorDeCarga, setErrorDeCarga] = useState(
    errorInicial
      ? "No se pudieron cargar los mensajes. Revisa tu conexión y toca Reintentar."
      : "",
  );
  const [errorDeEnvio, setErrorDeEnvio] = useState("");
  const [analisis, setAnalisis] = useState<Record<string, EstadoDelComprobante>>({});
  const [comprobantePendiente, setComprobantePendiente] = useState(
    conversacion.comprobantePendiente,
  );
  // Sube con cada aviso que puede traer un servicio recien terminado.
  const [recargaValoracion, setRecargaValoracion] = useState(0);

  const mensajesRef = useRef(mensajes);
  mensajesRef.current = mensajes;
  const zonaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const escribiendoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Altura antes de anteponer una pagina antigua, para no mover lo que se lee.
  const anclaAntiguos = useRef<{ alto: number; scroll: number } | null>(null);
  const seguirAlFinal = useRef(true);
  const sincronizando = useRef<Promise<void> | null>(null);
  const repetirSincronizacion = useRef(false);
  const releyendoResumen = useRef(false);
  const repetirResumen = useRef(false);

  const irAlFinal = useCallback((suave: boolean) => {
    const zona = zonaRef.current;
    if (!zona) return;
    zona.scrollTo({
      top: zona.scrollHeight,
      behavior: suave && !movimientoReducido() ? "smooth" : "auto",
    });
  }, []);

  // Al abrir, el ultimo mensaje a la vista, como en cualquier mensajeria.
  useLayoutEffect(() => {
    irAlFinal(false);
  }, [irAlFinal]);

  // Tras cada cambio: o se conserva la posicion (pagina antigua) o se baja al
  // final si la persona ya estaba ahi. Si estaba leyendo arriba, no se le mueve.
  useLayoutEffect(() => {
    const zona = zonaRef.current;
    if (!zona) return;
    const ancla = anclaAntiguos.current;
    if (ancla) {
      anclaAntiguos.current = null;
      zona.scrollTop = zona.scrollHeight - ancla.alto + ancla.scroll;
      return;
    }
    if (seguirAlFinal.current) irAlFinal(true);
  }, [mensajes, escribiendo, irAlFinal]);

  function alDesplazar() {
    const zona = zonaRef.current;
    if (!zona) return;
    seguirAlFinal.current =
      zona.scrollHeight - zona.scrollTop - zona.clientHeight < CERCA_DEL_FINAL_PX;
  }

  /** Pide una pagina por la API del navegador; `null` si fallo. */
  const pedirPagina = useCallback(
    async (desde: string | null): Promise<PaginaDeMensajes | null> => {
      const params = new URLSearchParams({ limit: "30" });
      if (desde) params.set("cursor", desde);
      const respuesta = await pedirConSesion(
        `/api/conversations/${conversationId}/messages?${params}`,
        { cache: "no-store" },
      );
      if (respuesta.status === 401) {
        // La sesion termino de verdad: al login, con regreso a este chat.
        window.location.assign(
          `/ingresar?siguiente=${encodeURIComponent(`/chats/${conversationId}`)}`,
        );
        return null;
      }
      if (!respuesta.ok) return null;
      return (await respuesta.json()) as PaginaDeMensajes;
    },
    [conversationId],
  );

  /**
   * Trae lo mas reciente y, si entre eso y lo que hay en pantalla quedo un
   * hueco (el canal estuvo caido), sigue hacia atras hasta enlazar. Las
   * llamadas que lleguen mientras corre se agrupan en una sola repeticion.
   */
  const sincronizar = useCallback(async (): Promise<void> => {
    if (sincronizando.current) {
      repetirSincronizacion.current = true;
      return sincronizando.current;
    }
    const tarea = (async () => {
      do {
        repetirSincronizacion.current = false;
        try {
          let desde: string | null = null;
          const recibidos: MensajeDelChat[] = [];
          for (let i = 0; i < MAXIMO_PAGINAS_HUECO; i++) {
            const pagina = await pedirPagina(desde);
            if (!pagina) throw new Error("pagina no disponible");
            recibidos.push(...pagina.items);
            if (!pagina.nextCursor || enlazaConLoConocido(mensajesRef.current, pagina.items)) {
              break;
            }
            desde = pagina.nextCursor;
          }
          setMensajes((actuales) => mezclarMensajes(actuales, recibidos));
          setErrorDeCarga("");
          // Si contesto la modelo, ya no esta escribiendo.
          if (recibidos.some((m) => m.sender !== "cliente")) setEscribiendo(false);
        } catch {
          setErrorDeCarga(
            "No se pudieron cargar los mensajes nuevos. Revisa tu conexión y toca Reintentar.",
          );
        }
      } while (repetirSincronizacion.current);
    })();
    sincronizando.current = tarea;
    try {
      await tarea;
    } finally {
      sincronizando.current = null;
    }
  }, [pedirPagina]);

  /**
   * Relee el resumen (estado y comprobante pendiente). Es una foto del
   * servidor: tras un aviso del sistema, un comprobante analizado o un cambio
   * de estado, lo que dijo al abrir ya puede no valer. Un fallo aqui no se
   * muestra: lo que hay en pantalla sigue siendo usable y el siguiente evento
   * vuelve a intentarlo.
   */
  const releerResumen = useCallback(async (): Promise<void> => {
    if (releyendoResumen.current) {
      repetirResumen.current = true;
      return;
    }
    releyendoResumen.current = true;
    try {
      do {
        repetirResumen.current = false;
        const respuesta = await pedirConSesion(`/api/conversations/${conversationId}`, {
          cache: "no-store",
        });
        if (!respuesta.ok) return;
        const resumen = (await respuesta.json()) as ResumenDeConversacion;
        if (ESTADOS.includes(resumen.status)) setStatus(resumen.status);
        setComprobantePendiente(Boolean(resumen.comprobantePendiente));
      } while (repetirResumen.current);
    } catch {
      // Sin red: se reintenta con el siguiente evento o al volver a la pestaña.
    } finally {
      releyendoResumen.current = false;
    }
  }, [conversationId]);

  const alEvento = useCallback(
    (evento: EventoDelChat) => {
      if (evento.data?.conversationId !== conversationId) return;
      switch (evento.type) {
        case "receipt_status": {
          const { messageId, status: resultado } = evento.data ?? {};
          if (
            messageId &&
            resultado &&
            ESTADOS_DEL_COMPROBANTE.includes(resultado as EstadoDelComprobante)
          ) {
            setAnalisis((previo) => ({
              ...previo,
              [messageId]: resultado as EstadoDelComprobante,
            }));
          }
          void sincronizar();
          void releerResumen();
          break;
        }
        case "message_created":
          setRecargaValoracion((n) => n + 1);
          void sincronizar();
          // Un aviso del sistema puede pedir (o dar por recibido) el comprobante.
          void releerResumen();
          break;
        case "typing":
          if (escribiendoTimer.current) clearTimeout(escribiendoTimer.current);
          escribiendoTimer.current = null;
          if (!estaEscribiendo(evento.data)) {
            setEscribiendo(false);
            break;
          }
          setEscribiendo(true);
          escribiendoTimer.current = setTimeout(
            () => setEscribiendo(false),
            DURACION_ESCRIBIENDO_MS,
          );
          break;
        case "conversation_status_changed": {
          const nuevo = evento.data?.status as EstadoConversacion | undefined;
          if (nuevo && ESTADOS.includes(nuevo)) setStatus(nuevo);
          setRecargaValoracion((n) => n + 1);
          void releerResumen();
          break;
        }
        // `conversation_mode_changed` (IA o equipo) no se le muestra al cliente.
      }
    },
    [conversationId, sincronizar, releerResumen],
  );

  const canal = useCanalCliente(alEvento, () => {
    void sincronizar();
    void releerResumen();
  });

  useEffect(
    () => () => {
      if (escribiendoTimer.current) clearTimeout(escribiendoTimer.current);
    },
    [],
  );

  async function cargarAntiguos() {
    if (!cursor || cargandoAntiguos) return;
    setCargandoAntiguos(true);
    try {
      const pagina = await pedirPagina(cursorMasAntiguo(mensajesRef.current) ?? cursor);
      if (!pagina) throw new Error("pagina no disponible");
      const zona = zonaRef.current;
      if (zona) anclaAntiguos.current = { alto: zona.scrollHeight, scroll: zona.scrollTop };
      setHistorial((previo) => new Set([...previo, ...pagina.items.map((m) => m.id)]));
      setMensajes((actuales) => mezclarMensajes(actuales, pagina.items));
      setCursor(pagina.nextCursor);
      setErrorDeCarga("");
      // Si ya no hay mas, el boton desaparece: el foco pasa a la conversacion
      // en vez de perderse en el documento.
      if (!pagina.nextCursor) zonaRef.current?.focus();
    } catch {
      setErrorDeCarga(
        "No se pudieron cargar los mensajes anteriores. Revisa tu conexión y vuelve a intentarlo.",
      );
    } finally {
      setCargandoAntiguos(false);
    }
  }

  async function mandar(
    clientMessageId: string,
    contenido: { body?: string; location?: UbicacionDelMensaje },
  ) {
    setErrorDeEnvio("");
    try {
      const resultado = await enviarMensajeAction(conversationId, {
        clientMessageId,
        ...contenido,
      });
      if (resultado.success) {
        setMensajes((actuales) => mezclarMensajes(actuales, [resultado.data]));
        return;
      }
      setMensajes((actuales) => marcarEnvio(actuales, clientMessageId, "error"));
      setErrorDeEnvio(resultado.error);
      if (resultado.conflicto) setStatus("cerrada");
    } catch (error) {
      if (esRedireccion(error)) throw error;
      setMensajes((actuales) => marcarEnvio(actuales, clientMessageId, "error"));
      setErrorDeEnvio(
        "No se pudo enviar el mensaje. Revisa tu conexión y toca Reintentar junto al mensaje.",
      );
    }
  }

  function enviarNuevo(contenido: { body?: string; location?: UbicacionDelMensaje }) {
    const clientMessageId = nuevoId();
    seguirAlFinal.current = true;
    setMensajes((actuales) => [
      ...actuales,
      crearOptimista({ conversationId, clientMessageId, ...contenido }),
    ]);
    void mandar(clientMessageId, contenido);
  }

  async function mandarMedia(clientMessageId: string, media: MediaParaEnviar, pie?: string) {
    setErrorDeEnvio("");
    const problema = errorDeMedia({
      kind: media.kind,
      type: media.archivo.type,
      size: media.archivo.size,
    });
    if (problema) {
      setMensajes((actuales) => marcarEnvio(actuales, clientMessageId, "error"));
      setErrorDeEnvio(problema);
      return;
    }
    try {
      const datos = new FormData();
      datos.append("file", media.archivo, media.archivo.name);
      datos.append("clientMessageId", clientMessageId);
      if (pie) datos.append("body", pie);
      if (media.kind === "audio" && media.durationMs) {
        datos.append("durationMs", String(Math.round(media.durationMs)));
      }
      const resultado = await enviarMediaAction(conversationId, datos);
      if (resultado.success) {
        setMensajes((actuales) => mezclarMensajes(actuales, [resultado.data]));
        return;
      }
      setMensajes((actuales) => marcarEnvio(actuales, clientMessageId, "error"));
      setErrorDeEnvio(resultado.error);
      if (resultado.conflicto) setStatus("cerrada");
    } catch (error) {
      if (esRedireccion(error)) throw error;
      setMensajes((actuales) => marcarEnvio(actuales, clientMessageId, "error"));
      setErrorDeEnvio(
        "No se pudo enviar el archivo. Revisa tu conexión y toca Reintentar junto al mensaje.",
      );
    }
  }

  function enviarMediaNueva(media: MediaParaEnviar, pie?: string) {
    const clientMessageId = nuevoId();
    seguirAlFinal.current = true;
    setMensajes((actuales) => [
      ...actuales,
      crearOptimista({ conversationId, clientMessageId, body: pie, media }),
    ]);
    void mandarMedia(clientMessageId, media, pie);
  }

  function reintentar(clientMessageId: string) {
    const original = mensajesRef.current.find(
      (m) => esOptimista(m) && m.clientMessageId === clientMessageId,
    );
    if (!original?.reintento) return;
    // Mismo clientMessageId: si el primero si llego, el backend no lo duplica.
    setMensajes((actuales) => marcarEnvio(actuales, clientMessageId, "enviando"));
    if (original.reintento.media) {
      void mandarMedia(clientMessageId, original.reintento.media, original.reintento.body);
      return;
    }
    void mandar(clientMessageId, original.reintento);
  }

  function alEnviarComprobante(mensaje: MensajeDelChat) {
    seguirAlFinal.current = true;
    setMensajes((actuales) => mezclarMensajes(actuales, [mensaje]));
    // El resumen leido antes de subirlo todavia dice "pendiente".
    setComprobantePendiente(false);
    void releerResumen();
  }

  const raizRef = useAreaVisible<HTMLDivElement>();

  // El corte entre historial y lo nuevo: desde el primer mensaje que no estaba.
  const corte = useMemo(() => {
    const i = mensajes.findIndex((m) => !historial.has(m.id));
    return i === -1 ? mensajes.length : i;
  }, [mensajes, historial]);
  const antiguos = mensajes.slice(0, corte);
  const nuevos = mensajes.slice(corte);
  const cerrada = status === "cerrada";
  const mostrarComprobante = debeMostrarComprobante(
    { status, comprobantePendiente },
    mensajes,
    analisis,
  );

  return (
    <div ref={raizRef} className="fixed inset-x-0 top-0 flex h-dvh flex-col bg-black">
      <EncabezadoAsistente modelo={conversacion.employee} status={status} canal={canal} />

      <div
        ref={zonaRef}
        onScroll={alDesplazar}
        tabIndex={0}
        role="region"
        aria-label={`Conversación con ${nombre}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/40"
      >
        <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-4">
          {cursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={cargarAntiguos}
                disabled={cargandoAntiguos}
                aria-busy={cargandoAntiguos}
                className="min-h-11 rounded-full border border-zinc-800 px-5 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-400 transition-colors hover:border-[#C5A55A]/50 hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
              >
                {cargandoAntiguos ? "Cargando mensajes" : "Ver mensajes anteriores"}
              </button>
            </div>
          ) : null}

          {mensajes.length === 0 && !errorDeCarga ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-400">
              Escribe tu primer mensaje. El asistente de {nombre} te responderá
              por aquí.
            </p>
          ) : null}

          <ol aria-label="Mensajes anteriores" className="space-y-3">
            {antiguos.map((m) => (
              <Burbuja
                key={m.id}
                mensaje={m}
                nombreModelo={nombre}
                onReintentar={reintentar}
                analisis={analisis[m.id]}
              />
            ))}
          </ol>
          <ol role="log" aria-live="polite" aria-label="Mensajes nuevos" className="space-y-3">
            {nuevos.map((m) => (
              <Burbuja
                key={m.clientMessageId ?? m.id}
                mensaje={m}
                nombreModelo={nombre}
                onReintentar={reintentar}
                analisis={analisis[m.id]}
                animar
              />
            ))}
          </ol>

          {/* Fuera del registro: es un estado pasajero, no un mensaje. */}
          <IndicadorEscribiendo
            visible={escribiendo && !cerrada}
            texto={`${nombre} está escribiendo`}
          />
        </div>
      </div>

      <div className="shrink-0 bg-[#050505]">
        <div className="mx-auto w-full max-w-2xl space-y-2 px-3 pt-2 empty:hidden">
          {errorDeCarga ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <ErrorDeFormulario mensaje={errorDeCarga} />
              </div>
              <button
                type="button"
                onClick={() => void sincronizar()}
                className="min-h-11 rounded-lg border border-[#C5A55A]/50 px-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
              >
                Reintentar
              </button>
            </div>
          ) : null}
          {mostrarComprobante ? (
            <SubirComprobante conversationId={conversationId} onEnviado={alEnviarComprobante} />
          ) : null}
          {/* Tambien con el chat cerrado: se cierra al terminar el servicio. */}
          <ValorarServicio
            empleadaId={conversacion.employee.id}
            recarga={recargaValoracion}
          />
        </div>
        <BarraEscritura
          nombreModelo={nombre}
          cerrada={cerrada}
          error={errorDeEnvio}
          onEnviar={(texto) => enviarNuevo({ body: texto })}
          onEnviarUbicacion={(location) => enviarNuevo({ location })}
          onEnviarMedia={enviarMediaNueva}
          textareaRef={textareaRef}
        />
      </div>
    </div>
  );
}
