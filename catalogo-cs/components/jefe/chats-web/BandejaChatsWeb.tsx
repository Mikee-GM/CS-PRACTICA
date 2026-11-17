"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, MessageCircle, Search } from "lucide-react";

import { useJefeRealtime, type JefeRealtimeEvent } from "@/hooks/useJefeRealtime";
import {
  FILTROS_DE_ESTADO,
  queRecargar,
  type ConversacionDelEquipo,
  type UsuarioDelPanel,
} from "@/lib/chats-del-equipo";
import { pedirConSesion } from "@/lib/client-fetch";
import type { EstadoConversacion } from "@/lib/conversaciones";
import ConversacionChatWeb from "./ConversacionChatWeb";
import FilaChatWeb from "./FilaChatWeb";

/** Respaldo por si el fin de "escribiendo" no llega. */
const DURACION_ESCRIBIENDO_MS = 10_000;
const ESPERA_BUSQUEDA_MS = 350;
const ESPERA_RECARGA_MS = 400;

/**
 * Bandeja del chat web para jefes y admins: lista con filtros y busqueda a un
 * lado, conversacion al otro. En el telefono se ve una cosa a la vez.
 *
 * Tiempo real con el canal de jefes (`useJefeRealtime`). Los eventos solo
 * traen ids; `queRecargar` decide que pedir. Las rafagas se agrupan en una
 * sola relectura de la bandeja, y una respuesta que llega tarde (de una
 * busqueda anterior) se descarta.
 */
export default function BandejaChatsWeb({
  usuario,
  inicial,
  errorInicial,
  encabezado,
  className = "",
}: {
  usuario: UsuarioDelPanel;
  inicial: ConversacionDelEquipo[];
  errorInicial: boolean;
  /** Lo que va arriba de la lista (por ejemplo, el selector de bandeja). */
  encabezado?: React.ReactNode;
  className?: string;
}) {
  const idBase = useId();
  const [conversaciones, setConversaciones] = useState(inicial);
  const [estado, setEstado] = useState<EstadoConversacion | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorBandeja, setErrorBandeja] = useState(
    errorInicial ? "No se pudo cargar la bandeja. Revisa tu conexión y toca Reintentar." : "",
  );
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  // La ultima version conocida: si un filtro la saca de la lista, sigue abierta.
  const [abierta, setAbierta] = useState<ConversacionDelEquipo | null>(null);
  const [vistaMovil, setVistaMovil] = useState<"bandeja" | "chat">("bandeja");
  const [senalMensajes, setSenalMensajes] = useState(0);
  const [escribiendo, setEscribiendo] = useState(false);

  const filtroRef = useRef({ estado, busqueda });
  filtroRef.current = { estado, busqueda };
  const abiertaIdRef = useRef(abiertaId);
  abiertaIdRef.current = abiertaId;
  const peticion = useRef(0);
  const recarga = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escribiendoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releer = useCallback(async () => {
    const numero = ++peticion.current;
    const { estado: filtro, busqueda: q } = filtroRef.current;
    const params = new URLSearchParams();
    if (filtro) params.set("estado", filtro);
    if (q.trim()) params.set("q", q.trim().slice(0, 100));
    const consulta = params.toString();
    setCargando(true);
    try {
      const respuesta = await pedirConSesion(
        `/api/staff/conversations${consulta ? `?${consulta}` : ""}`,
        { cache: "no-store" },
      );
      if (numero !== peticion.current) return;
      if (respuesta.status === 401) {
        window.location.assign("/ingresar");
        return;
      }
      if (!respuesta.ok) throw new Error(`bandeja ${respuesta.status}`);
      const lista = (await respuesta.json()) as ConversacionDelEquipo[];
      if (numero !== peticion.current) return;
      setConversaciones(lista);
      setErrorBandeja("");
      const actual = lista.find((c) => c.id === abiertaIdRef.current);
      if (actual) setAbierta(actual);
    } catch {
      if (numero !== peticion.current) return;
      setErrorBandeja(
        "No se pudo actualizar la bandeja. Lo que ves puede estar desactualizado; toca Reintentar.",
      );
    } finally {
      if (numero === peticion.current) setCargando(false);
    }
  }, []);

  const programarRelectura = useCallback(
    (espera = ESPERA_RECARGA_MS) => {
      if (recarga.current) clearTimeout(recarga.current);
      recarga.current = setTimeout(() => {
        recarga.current = null;
        void releer();
      }, espera);
    },
    [releer],
  );

  // Filtro o busqueda nuevos: se relee (la busqueda, con una pausa al teclear).
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    programarRelectura(ESPERA_BUSQUEDA_MS);
  }, [estado, busqueda, programarRelectura]);

  const fijarEscribiendo = useCallback((activo: boolean) => {
    if (escribiendoTimer.current) clearTimeout(escribiendoTimer.current);
    escribiendoTimer.current = null;
    setEscribiendo(activo);
    if (activo) {
      escribiendoTimer.current = setTimeout(() => setEscribiendo(false), DURACION_ESCRIBIENDO_MS);
    }
  }, []);

  const alEvento = useCallback(
    (evento: JefeRealtimeEvent) => {
      const plan = queRecargar(evento, abiertaIdRef.current);
      if (!plan) return;
      if (plan.bandeja) programarRelectura();
      if (plan.mensajes) setSenalMensajes((n) => n + 1);
      if (plan.escribiendo !== null) fijarEscribiendo(plan.escribiendo);
    },
    [programarRelectura, fijarEscribiendo],
  );

  // Al (re)conectar pudo perderse cualquier cosa: bandeja y conversacion.
  const alConectar = useCallback(() => {
    programarRelectura();
    setSenalMensajes((n) => n + 1);
  }, [programarRelectura]);

  useJefeRealtime({ onEvent: alEvento, onConnected: alConectar });

  // La aplicacion instalada vuelve del bolsillo con el canal dormido.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState === "visible") alConectar();
    }
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [alConectar]);

  useEffect(
    () => () => {
      if (recarga.current) clearTimeout(recarga.current);
      if (escribiendoTimer.current) clearTimeout(escribiendoTimer.current);
    },
    [],
  );

  function abrir(conversacion: ConversacionDelEquipo) {
    setAbiertaId(conversacion.id);
    setAbierta(conversacion);
    fijarEscribiendo(false);
    setVistaMovil("chat");
  }

  const actualizarAbierta = useCallback((cambios: Partial<ConversacionDelEquipo>) => {
    const id = abiertaIdRef.current;
    if (!id) return;
    setAbierta((actual) => (actual && actual.id === id ? { ...actual, ...cambios } : actual));
    setConversaciones((lista) => lista.map((c) => (c.id === id ? { ...c, ...cambios } : c)));
  }, []);

  const conAtencion = conversaciones.filter((c) => c.requiereAtencion).length;
  const busquedaId = `${idBase}-busqueda`;

  return (
    <div
      className={`relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black lg:grid lg:grid-cols-[minmax(280px,360px)_1fr] ${className}`}
    >
      <aside
        aria-label="Bandeja de chats web"
        className={`${vistaMovil === "bandeja" ? "flex" : "hidden"} h-full min-h-0 flex-col border-zinc-800 lg:flex lg:border-r`}
      >
        <header className="shrink-0 space-y-3 border-b border-zinc-800 px-3 py-3">
          {encabezado}
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C5A55A]">
                Chat web
              </p>
              <h1 className="font-heading text-2xl font-semibold text-white">Clientes</h1>
            </div>
            <p className="text-right text-xs tabular-nums text-zinc-500">
              {conversaciones.length}
              {conAtencion > 0 ? (
                <span className="block text-[#E8D5A3]">{conAtencion} por atender</span>
              ) : null}
            </p>
          </div>

          <div>
            <label htmlFor={busquedaId} className="sr-only">
              Buscar por cliente o modelo
            </label>
            <div className="flex h-11 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 focus-within:border-[#C5A55A]/70">
              <Search aria-hidden="true" size={15} className="shrink-0 text-zinc-600" />
              <input
                id={busquedaId}
                type="search"
                value={busqueda}
                maxLength={100}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Cliente, correo o modelo"
                className="min-w-0 flex-1 bg-transparent text-base text-zinc-200 outline-none placeholder:text-zinc-600 sm:text-sm"
              />
              {cargando ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-zinc-500 motion-reduce:animate-none" />
              ) : null}
            </div>
          </div>

          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
            {FILTROS_DE_ESTADO.map(({ valor, etiqueta }) => {
              const activo = valor === estado;
              return (
                <button
                  key={etiqueta}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setEstado(valor)}
                  className={`min-h-11 rounded-full border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 sm:min-h-9 ${
                    activo
                      ? "border-[#C5A55A] bg-[#C5A55A] text-black"
                      : "border-zinc-800 text-zinc-400 hover:border-[#C5A55A]/50 hover:text-[#E8D5A3]"
                  }`}
                >
                  {etiqueta}
                </button>
              );
            })}
          </div>

          {errorBandeja ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 flex-1 text-xs text-red-400">
                {errorBandeja}
              </p>
              <button
                type="button"
                onClick={() => void releer()}
                className="min-h-11 rounded-lg border border-[#C5A55A]/50 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
              >
                Reintentar
              </button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={cargando}>
          {conversaciones.length > 0 ? (
            <ul>
              {conversaciones.map((c) => (
                <FilaChatWeb
                  key={c.id}
                  conversacion={c}
                  usuario={usuario}
                  seleccionada={c.id === abiertaId}
                  onAbrir={() => abrir(c)}
                />
              ))}
            </ul>
          ) : (
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium text-zinc-300">
                {busqueda.trim() || estado
                  ? "Ninguna conversación coincide con estos filtros"
                  : "No hay conversaciones abiertas"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                {busqueda.trim() || estado
                  ? "Cambia el filtro o la búsqueda para ver otras."
                  : "Aquí aparecen los chats web de las modelos a tu cargo en cuanto un cliente escribe."}
              </p>
            </div>
          )}
        </div>
      </aside>

      <div
        className={`${vistaMovil === "chat" ? "flex" : "hidden"} h-full min-h-0 min-w-0 flex-col lg:flex`}
      >
        {abierta ? (
          <ConversacionChatWeb
            key={abierta.id}
            conversacion={abierta}
            usuario={usuario}
            senalMensajes={senalMensajes}
            escribiendo={escribiendo}
            onActualizar={actualizarAbierta}
            onReleerBandeja={() => programarRelectura(0)}
            onVolver={() => setVistaMovil("bandeja")}
          />
        ) : (
          <section className="hidden h-full flex-col items-center justify-center px-8 text-center lg:flex">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-black text-zinc-600">
              <MessageCircle aria-hidden="true" size={22} />
            </span>
            <h2 className="mt-4 font-heading text-2xl text-zinc-300">Elige una conversación</h2>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
              Verás el historial, quién la atiende y, si hay una solicitud, podrás aceptarla o
              rechazarla.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
