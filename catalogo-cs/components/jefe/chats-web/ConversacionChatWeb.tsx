"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  aceptarSolicitudAction,
  devolverControlAction,
  enviarMensajeDelEquipoAction,
  rechazarSolicitudAction,
  tomarControlAction,
} from "@/lib/actions/chats-del-equipo";
import {
  accionesDisponibles,
  etiquetaDeMotivo,
  resumenDelBorrador,
  textoDeControl,
  type ConversacionDelEquipo,
  type MensajeParaElEquipo,
  type PaginaDelEquipo,
  type UsuarioDelPanel,
} from "@/lib/chats-del-equipo";
import { pedirConSesion } from "@/lib/client-fetch";
import {
  cursorMasAntiguo,
  enlazaConLoConocido,
  etiquetaDeEstado,
  mezclarMensajes,
} from "@/lib/conversaciones";
import { esRedireccion } from "@/lib/es-redireccion";
import DialogoConfirmacion from "./DialogoConfirmacion";
import MensajeDelEquipo from "./MensajeDelEquipo";
import VisorDeImagen from "./VisorDeImagen";

type Dialogo = "tomar" | "devolver" | "aceptar" | "rechazar" | null;

/** Paginas como maximo al rellenar un hueco tras una caida del canal. */
const MAXIMO_PAGINAS_HUECO = 5;
const CERCA_DEL_FINAL_PX = 120;
const MAX_MENSAJE = 2000;
const MAX_MOTIVO = 500;

const BOTON_SECUNDARIO =
  "min-h-11 rounded-xl border px-4 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-50";

/**
 * Una conversacion del chat web, del lado del equipo.
 *
 * La carga de mensajes sigue el mismo esquema que el chat del cliente
 * (`VistaChat`): primera pagina, paginas antiguas hacia arriba y "lo mas
 * reciente" cada vez que el canal avisa, con la misma mezcla. El historial va
 * fuera del `role="log"`; solo lo que llega con la conversacion abierta se
 * anuncia.
 *
 * El estado de la conversacion (modo, dueño, borrador) no vive aqui: viene de
 * la bandeja, que se relee con cada evento. Tras una accion se avisa al padre
 * con lo que devolvio el servidor para no esperar a esa relectura.
 */
export default function ConversacionChatWeb({
  conversacion,
  usuario,
  senalMensajes,
  escribiendo,
  onActualizar,
  onReleerBandeja,
  onVolver,
}: {
  conversacion: ConversacionDelEquipo;
  usuario: UsuarioDelPanel;
  /** Cambia cuando hay que pedir lo mas reciente (evento o reconexion). */
  senalMensajes: number;
  escribiendo: boolean;
  onActualizar: (cambios: Partial<ConversacionDelEquipo>) => void;
  onReleerBandeja: () => void;
  onVolver: () => void;
}) {
  const conversationId = conversacion.id;
  const idBase = useId();
  const [mensajes, setMensajes] = useState<MensajeParaElEquipo[]>([]);
  const [historial, setHistorial] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [cargandoAntiguos, setCargandoAntiguos] = useState(false);
  const [errorDeCarga, setErrorDeCarga] = useState("");

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorDeEnvio, setErrorDeEnvio] = useState("");

  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [ocupado, setOcupado] = useState(false);
  const [errorDialogo, setErrorDialogo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [imagen, setImagen] = useState<{ url: string; titulo: string } | null>(null);

  const mensajesRef = useRef(mensajes);
  mensajesRef.current = mensajes;
  const zonaRef = useRef<HTMLDivElement>(null);
  const seguirAlFinal = useRef(true);
  const anclaAntiguos = useRef<{ alto: number; scroll: number } | null>(null);
  const sincronizando = useRef<Promise<void> | null>(null);
  const repetir = useRef(false);
  // Se conserva entre reintentos: el backend no duplica un mismo id.
  const clientMessageId = useRef<string | null>(null);

  const acciones = accionesDisponibles(conversacion, usuario);
  const resumen = useMemo(() => resumenDelBorrador(mensajes), [mensajes]);

  const pedirPagina = useCallback(
    async (desde: string | null): Promise<PaginaDelEquipo | null> => {
      const params = new URLSearchParams({ limit: "30" });
      if (desde) params.set("cursor", desde);
      const respuesta = await pedirConSesion(
        `/api/staff/conversations/${conversationId}/messages?${params}`,
        { cache: "no-store" },
      );
      if (respuesta.status === 401) {
        window.location.assign("/admin");
        return null;
      }
      if (respuesta.status === 404) {
        throw new Error("fuera de alcance");
      }
      if (!respuesta.ok) return null;
      return (await respuesta.json()) as PaginaDelEquipo;
    },
    [conversationId],
  );

  // Primera pagina: forma el historial, que no se anuncia.
  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const pagina = await pedirPagina(null);
        if (!vigente) return;
        if (!pagina) throw new Error("pagina no disponible");
        setMensajes(mezclarMensajes([], pagina.items));
        setHistorial(new Set(pagina.items.map((m) => m.id)));
        setCursor(pagina.nextCursor);
        setErrorDeCarga("");
      } catch (error) {
        if (!vigente) return;
        setErrorDeCarga(
          error instanceof Error && error.message === "fuera de alcance"
            ? "Esta conversación ya no existe o no está a tu cargo. Elige otra de la bandeja."
            : "No se pudieron cargar los mensajes. Revisa tu conexión y toca Reintentar.",
        );
      } finally {
        if (vigente) setCargandoInicial(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [pedirPagina]);

  const sincronizar = useCallback(async (): Promise<void> => {
    if (sincronizando.current) {
      repetir.current = true;
      return sincronizando.current;
    }
    const tarea = (async () => {
      do {
        repetir.current = false;
        try {
          let desde: string | null = null;
          const recibidos: MensajeParaElEquipo[] = [];
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
        } catch {
          setErrorDeCarga(
            "No se pudieron cargar los mensajes nuevos. Revisa tu conexión y toca Reintentar.",
          );
        }
      } while (repetir.current);
    })();
    sincronizando.current = tarea;
    try {
      await tarea;
    } finally {
      sincronizando.current = null;
    }
  }, [pedirPagina]);

  // Cada aviso del canal (o reconexion) que toca a esta conversacion.
  const primeraSenal = useRef(senalMensajes);
  useEffect(() => {
    if (senalMensajes === primeraSenal.current) return;
    void sincronizar();
  }, [senalMensajes, sincronizar]);

  // Bajar al final si se estaba ahi; conservar la posicion al anteponer antiguos.
  useEffect(() => {
    const zona = zonaRef.current;
    if (!zona) return;
    const ancla = anclaAntiguos.current;
    if (ancla) {
      anclaAntiguos.current = null;
      zona.scrollTop = zona.scrollHeight - ancla.alto + ancla.scroll;
      return;
    }
    if (seguirAlFinal.current) zona.scrollTop = zona.scrollHeight;
  }, [mensajes, escribiendo]);

  function alDesplazar() {
    const zona = zonaRef.current;
    if (!zona) return;
    seguirAlFinal.current =
      zona.scrollHeight - zona.scrollTop - zona.clientHeight < CERCA_DEL_FINAL_PX;
  }

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
      if (!pagina.nextCursor) zonaRef.current?.focus();
    } catch {
      setErrorDeCarga(
        "No se pudieron cargar los mensajes anteriores. Revisa tu conexión y vuelve a intentarlo.",
      );
    } finally {
      setCargandoAntiguos(false);
    }
  }

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const cuerpo = texto.trim();
    if (!cuerpo || enviando || !acciones.escribir) return;
    clientMessageId.current ??= crypto.randomUUID();
    setEnviando(true);
    setErrorDeEnvio("");
    try {
      const resultado = await enviarMensajeDelEquipoAction(conversationId, {
        body: cuerpo,
        clientMessageId: clientMessageId.current,
      });
      if (!resultado.success) {
        setErrorDeEnvio(resultado.error);
        if (resultado.conflicto) onReleerBandeja();
        return;
      }
      clientMessageId.current = null;
      seguirAlFinal.current = true;
      setMensajes((actuales) => mezclarMensajes(actuales, [resultado.data]));
      // Solo se borra si no se escribio otra cosa mientras se enviaba.
      setTexto((actual) => (actual.trim() === cuerpo ? "" : actual));
    } catch (error) {
      if (esRedireccion(error)) throw error;
      setErrorDeEnvio(
        "No se pudo enviar el mensaje. Revisa tu conexión y vuelve a pulsar Enviar; no se duplicará.",
      );
    } finally {
      setEnviando(false);
    }
  }

  function alPulsarTecla(evento: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key !== "Enter" || evento.shiftKey) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    evento.preventDefault();
    // Enter confirma la palabra en un IME; Safari lo entrega con keyCode 229.
    if (evento.nativeEvent.isComposing || evento.keyCode === 229) return;
    evento.currentTarget.form?.requestSubmit();
  }

  function abrirDialogo(cual: Exclude<Dialogo, null>) {
    setErrorDialogo("");
    setMotivo("");
    setDialogo(cual);
  }

  function cerrarDialogo() {
    if (ocupado) return;
    setDialogo(null);
  }

  async function confirmar() {
    if (!dialogo || ocupado) return;
    setOcupado(true);
    setErrorDialogo("");
    try {
      if (dialogo === "tomar" || dialogo === "devolver") {
        const forzar = dialogo === "tomar" ? acciones.tomarForzando : acciones.devolverForzando;
        const resultado =
          dialogo === "tomar"
            ? await tomarControlAction(conversationId, forzar)
            : await devolverControlAction(conversationId, forzar);
        if (!resultado.success) {
          setErrorDialogo(resultado.error);
          if (resultado.conflicto) onReleerBandeja();
          return;
        }
        onActualizar({
          mode: resultado.data.mode,
          humanOwnerId: resultado.data.humanOwnerId,
          ...(dialogo === "devolver"
            ? {
                motivosDeAtencion: conversacion.motivosDeAtencion.filter(
                  (m) => m !== "entregada_al_equipo",
                ),
              }
            : {}),
        });
        toast.success(
          dialogo === "tomar"
            ? "Ahora atiendes tú esta conversación."
            : "La IA vuelve a atender esta conversación.",
        );
      } else {
        const resultado =
          dialogo === "aceptar"
            ? await aceptarSolicitudAction(conversationId)
            : await rechazarSolicitudAction(conversationId, motivo);
        if (!resultado.success) {
          setErrorDialogo(resultado.error);
          if (resultado.conflicto) onReleerBandeja();
          return;
        }
        onActualizar({
          status: resultado.data.status,
          bookingSessionId: resultado.data.bookingSessionId,
          serviceId: resultado.data.serviceId,
        });
        toast.success(
          dialogo === "aceptar"
            ? "Solicitud aceptada. Se avisó al cliente."
            : "Solicitud rechazada. Se avisó al cliente.",
        );
        void sincronizar();
      }
      setDialogo(null);
      onReleerBandeja();
    } catch (error) {
      if (esRedireccion(error)) throw error;
      setErrorDialogo("No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.");
    } finally {
      setOcupado(false);
    }
  }

  const corte = useMemo(() => {
    const i = mensajes.findIndex((m) => !historial.has(m.id));
    return i === -1 ? mensajes.length : i;
  }, [mensajes, historial]);
  const antiguos = mensajes.slice(0, corte);
  const nuevos = mensajes.slice(corte);
  const restantes = MAX_MENSAJE - texto.length;
  const ayudaEscrituraId = `${idBase}-ayuda`;
  const errorEnvioId = `${idBase}-error`;

  return (
    <section
      aria-labelledby={`${idBase}-titulo`}
      className="flex h-full min-h-0 min-w-0 flex-col bg-[#050505]"
    >
      <header className="shrink-0 space-y-2 border-b border-zinc-800 px-3 py-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onVolver}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 hover:border-[#C5A55A] hover:text-[#C5A55A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 lg:hidden"
          >
            <ChevronLeft aria-hidden="true" size={18} />
            <span className="sr-only">Volver a la bandeja</span>
          </button>
          <div className="min-w-0 flex-1">
            <h2 id={`${idBase}-titulo`} className="font-heading text-2xl font-semibold leading-tight text-white">
              {conversacion.client.nombre}
            </h2>
            <p className="text-xs text-zinc-400">
              Con {conversacion.employee.nombreArtistico} · {etiquetaDeEstado(conversacion.status)} ·{" "}
              <span className={conversacion.mode === "HUMAN_ACTIVE" ? "text-[#E8D5A3]" : undefined}>
                {textoDeControl(conversacion, usuario)}
              </span>
            </p>
          </div>
        </div>

        {conversacion.motivosDeAtencion.length > 0 ? (
          <p className="flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]">
            <span className="sr-only">Requiere atención: </span>
            {conversacion.motivosDeAtencion.map((m) => (
              <span
                key={m}
                className="rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-2 py-0.5 text-[#E8D5A3]"
              >
                {etiquetaDeMotivo(m)}
              </span>
            ))}
          </p>
        ) : null}

        {acciones.tomar || acciones.devolver ? (
          <div className="flex flex-wrap gap-2">
            {acciones.tomar ? (
              <button
                type="button"
                onClick={() => abrirDialogo("tomar")}
                className={`${BOTON_SECUNDARIO} border-[#C5A55A]/60 text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black`}
              >
                Tomar control
              </button>
            ) : null}
            {acciones.devolver ? (
              <button
                type="button"
                onClick={() => abrirDialogo("devolver")}
                className={`${BOTON_SECUNDARIO} border-zinc-700 text-zinc-300 hover:border-[#C5A55A] hover:text-[#E8D5A3]`}
              >
                Devolver a la IA
              </button>
            ) : null}
          </div>
        ) : null}

        {acciones.decidir ? (
          <div className="space-y-2 rounded-xl border border-[#C5A55A]/30 bg-black p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C5A55A]">
              Solicitud por revisar
            </p>
            <p className="text-xs leading-relaxed text-zinc-300">
              {resumen ??
                "No aparece el resumen de la solicitud en los mensajes cargados. Carga mensajes anteriores para verlo."}
            </p>
            {conversacion.comprobanteEnRevision ? (
              <p className="text-xs text-[#E8D5A3]">Hay un comprobante de pago por revisar.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => abrirDialogo("aceptar")}
                className={`${BOTON_SECUNDARIO} border-[#C5A55A]/70 bg-[#C5A55A]/10 text-[#E8D5A3] hover:bg-[#C5A55A] hover:text-black`}
              >
                Aceptar solicitud
              </button>
              <button
                type="button"
                onClick={() => abrirDialogo("rechazar")}
                className={`${BOTON_SECUNDARIO} border-red-500/50 text-red-300 hover:bg-red-500 hover:text-black`}
              >
                Rechazar solicitud
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <div
        ref={zonaRef}
        onScroll={alDesplazar}
        tabIndex={0}
        role="region"
        aria-label={`Mensajes con ${conversacion.client.nombre}`}
        aria-busy={cargandoInicial}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/40"
      >
        <div className="space-y-3 px-3 py-4">
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

          {cargandoInicial ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Cargando mensajes
            </p>
          ) : mensajes.length === 0 && !errorDeCarga ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              Esta conversación aún no tiene mensajes.
            </p>
          ) : null}

          <ol aria-label="Mensajes anteriores" className="space-y-3">
            {antiguos.map((m) => (
              <MensajeDelEquipo key={m.id} mensaje={m} onVerImagen={setImagen} />
            ))}
          </ol>
          <ol role="log" aria-live="polite" aria-label="Mensajes nuevos" className="space-y-3">
            {nuevos.map((m) => (
              <MensajeDelEquipo key={m.id} mensaje={m} onVerImagen={setImagen} />
            ))}
          </ol>

          <p role="status" className="min-h-5 px-2 text-xs italic text-zinc-500">
            {escribiendo && conversacion.status !== "cerrada" ? "La IA está escribiendo" : null}
          </p>
        </div>
      </div>

      {/* Sin relleno de area segura: el panel ya deja el hueco de la barra
          inferior y del indicador de inicio por debajo de este contenedor. */}
      <div className="shrink-0 border-t border-zinc-800 bg-black px-3 pt-2 pb-3">
        {errorDeCarga ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p role="alert" className="min-w-0 flex-1 text-sm text-red-400">
              {errorDeCarga}
            </p>
            <button
              type="button"
              onClick={() => void sincronizar()}
              className={`${BOTON_SECUNDARIO} border-[#C5A55A]/50 text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black`}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {acciones.escribir ? (
          <form onSubmit={enviar} className="space-y-1.5">
            <div className="flex items-end gap-2">
              <label htmlFor={`${idBase}-texto`} className="sr-only">
                Responder al cliente
              </label>
              <textarea
                id={`${idBase}-texto`}
                rows={2}
                value={texto}
                maxLength={MAX_MENSAJE}
                onChange={(e) => {
                  // Otro texto es otro mensaje: reusar el id devolveria el anterior.
                  clientMessageId.current = null;
                  setTexto(e.target.value);
                }}
                onKeyDown={alPulsarTecla}
                placeholder={`Escribe como ${conversacion.employee.nombreArtistico}`}
                aria-describedby={`${ayudaEscrituraId}${errorDeEnvio ? ` ${errorEnvioId}` : ""}`}
                aria-invalid={errorDeEnvio ? true : undefined}
                className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-base text-white outline-none placeholder:text-zinc-600 focus:border-[#C5A55A] sm:text-sm"
              />
              <button
                type="submit"
                disabled={enviando || !texto.trim()}
                aria-busy={enviando}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#C5A55A]/70 text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40"
              >
                {enviando ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Send aria-hidden="true" className="h-4 w-4" />
                )}
                <span className="sr-only">{enviando ? "Enviando" : "Enviar"}</span>
              </button>
            </div>
            <p id={ayudaEscrituraId} className="flex justify-between gap-2 text-[11px] text-zinc-500">
              <span>El cliente lo verá como un mensaje de la modelo. Sin emojis.</span>
              <span className="tabular-nums">{restantes}</span>
            </p>
            <p id={errorEnvioId} role="alert" className="text-sm text-red-400 empty:hidden">
              {errorDeEnvio}
            </p>
          </form>
        ) : (
          <p className="py-2 text-center text-xs text-zinc-400">{acciones.motivoSinEscritura}</p>
        )}
      </div>

      <DialogoConfirmacion
        abierto={dialogo === "tomar"}
        titulo="Tomar el control"
        descripcion={
          acciones.tomarForzando
            ? "La atiende otra persona del equipo. Al tomarla, esa persona dejará de poder escribir y la IA no contestará hasta que la devuelvas."
            : "La IA dejará de contestar y el cliente verá un aviso de que una persona del equipo continúa la conversación."
        }
        etiquetaConfirmar={acciones.tomarForzando ? "Tomar de todos modos" : "Tomar control"}
        ocupado={ocupado}
        error={dialogo === "tomar" ? errorDialogo : ""}
        onConfirmar={confirmar}
        onCerrar={cerrarDialogo}
      />
      <DialogoConfirmacion
        abierto={dialogo === "devolver"}
        titulo="Devolver a la IA"
        descripcion={
          conversacion.mode === "AI_ACTIVE"
            ? "La conversación deja de estar marcada para el equipo y la IA sigue atendiéndola."
            : "La IA retoma la conversación y contestará lo que haya quedado sin respuesta. El cliente verá un aviso."
        }
        etiquetaConfirmar="Devolver a la IA"
        ocupado={ocupado}
        error={dialogo === "devolver" ? errorDialogo : ""}
        onConfirmar={confirmar}
        onCerrar={cerrarDialogo}
      />
      <DialogoConfirmacion
        abierto={dialogo === "aceptar"}
        titulo="Aceptar la solicitud"
        descripcion="Se crea el servicio con los datos de la solicitud y se avisa al cliente de que fue aprobada."
        etiquetaConfirmar="Aceptar solicitud"
        ocupado={ocupado}
        error={dialogo === "aceptar" ? errorDialogo : ""}
        onConfirmar={confirmar}
        onCerrar={cerrarDialogo}
      >
        {resumen ? (
          <p className="rounded-xl border border-zinc-800 bg-black p-3 text-xs leading-relaxed text-zinc-300">
            {resumen}
          </p>
        ) : null}
      </DialogoConfirmacion>
      <DialogoConfirmacion
        abierto={dialogo === "rechazar"}
        titulo="Rechazar la solicitud"
        descripcion="La solicitud se cancela y el cliente recibe un aviso neutro. La conversación sigue abierta."
        etiquetaConfirmar="Rechazar solicitud"
        tono="rojo"
        ocupado={ocupado}
        error={dialogo === "rechazar" ? errorDialogo : ""}
        motivo={{
          etiqueta: "Motivo (opcional)",
          ayuda: "Queda en el registro interno; el cliente no lo ve.",
          max: MAX_MOTIVO,
          valor: motivo,
          onCambio: setMotivo,
        }}
        onConfirmar={confirmar}
        onCerrar={cerrarDialogo}
      />
      <VisorDeImagen imagen={imagen} onCerrar={() => setImagen(null)} />
    </section>
  );
}
