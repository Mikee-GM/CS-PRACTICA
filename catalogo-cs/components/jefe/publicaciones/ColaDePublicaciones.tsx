"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";

import { useJefeRealtime, type JefeRealtimeEvent } from "@/hooks/useJefeRealtime";
import { pedirConSesion } from "@/lib/client-fetch";
import {
  ESTADO_POR_DEFECTO,
  EVENTO_PENDIENTES_CAMBIARON,
  FILTROS_DE_LA_COLA,
  contarPendientes,
  modelosDeLaCola,
  queRecargarPorEvento,
  rutaDeLaCola,
  siguienteTrasQuitar,
  unirCola,
  type AccionDelPost,
  type ColaDePosts,
  type EstadoFiltrable,
  type PostDelEquipo,
} from "@/lib/posts-del-equipo";
import FilaPublicacion from "./FilaPublicacion";
import RevisionDePublicacion from "./RevisionDePublicacion";

const ESPERA_RECARGA_MS = 400;
/** Cada cuanto se refresca "en cola hace 5 min" sin otra lectura. */
const TICK_DEL_RELOJ_MS = 60_000;

const HECHO: Record<AccionDelPost, string> = {
  aprobar: "Publicación aprobada.",
  rechazar: "Publicación rechazada. La modelo verá el motivo.",
  archivar: "Publicación archivada.",
};

/**
 * Cola de publicaciones para jefes y admins: lista a un lado, revision al
 * otro; en el telefono se ve una cosa a la vez y la pagina hace scroll normal.
 *
 * Pendientes del mas antiguo al mas nuevo, que es el orden en que hay que
 * atenderlos. Al decidir uno sale de la lista y se abre el siguiente con el
 * foco en su titulo. Un 409 o un 404 (otro jefe lo resolvio, o la modelo dejo
 * de estar a cargo) relee la cola y lo dice.
 *
 * Tiempo real con el canal de jefes: `post_pending` relee la cola con una
 * espera corta que agrupa rafagas, y al volver a la app o reconectar se relee
 * por si se perdio algo.
 */
export default function ColaDePublicaciones({
  inicial,
  errorInicial,
  encabezado,
  barraClassName,
}: {
  inicial: ColaDePosts;
  errorInicial: boolean;
  /** Lo que va arriba de la lista (por ejemplo, el selector de bandeja). */
  encabezado?: React.ReactNode;
  barraClassName?: string;
}) {
  const idBase = useId();
  const [posts, setPosts] = useState(inicial.items);
  const [cursor, setCursor] = useState(inicial.nextCursor);
  const [estado, setEstado] = useState<EstadoFiltrable>(ESTADO_POR_DEFECTO);
  const [modelo, setModelo] = useState<string>("");
  const [modelos, setModelos] = useState(() => modelosDeLaCola(inicial.items));
  const [cargando, setCargando] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorCola, setErrorCola] = useState(
    errorInicial ? "No se pudo cargar la cola. Revisa tu conexión y toca Reintentar." : "",
  );
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "conflicto" } | null>(null);
  const [abiertoId, setAbiertoId] = useState<string | null>(inicial.items[0]?.id ?? null);
  const [vistaMovil, setVistaMovil] = useState<"cola" | "revision">("cola");
  const [revisadas, setRevisadas] = useState<Record<string, string[]>>({});
  const [ahora, setAhora] = useState(() => new Date());

  const filtroRef = useRef({ estado, modelo });
  filtroRef.current = { estado, modelo };
  const peticion = useRef(0);
  const recarga = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const enfocarTitulo = useRef(false);

  const avisarContador = useCallback((pagina: ColaDePosts) => {
    window.dispatchEvent(
      new CustomEvent(EVENTO_PENDIENTES_CAMBIARON, { detail: contarPendientes(pagina) }),
    );
  }, []);

  const releer = useCallback(async () => {
    const numero = ++peticion.current;
    const { estado: filtro, modelo: employeeId } = filtroRef.current;
    setCargando(true);
    try {
      const respuesta = await pedirConSesion(rutaDeLaCola({ estado: filtro, employeeId }), {
        cache: "no-store",
      });
      if (numero !== peticion.current) return;
      if (respuesta.status === 401) {
        window.location.assign("/admin");
        return;
      }
      if (!respuesta.ok) throw new Error(`cola ${respuesta.status}`);
      const pagina = (await respuesta.json()) as ColaDePosts;
      if (numero !== peticion.current) return;
      setPosts(pagina.items);
      setCursor(pagina.nextCursor);
      setModelos((conocidas) => modelosDeLaCola(pagina.items, conocidas));
      setErrorCola("");
      setAhora(new Date());
      // Lo abierto sigue abierto si sigue en la lista; si no, el primero.
      setAbiertoId((actual) =>
        actual && pagina.items.some((p) => p.id === actual) ? actual : (pagina.items[0]?.id ?? null),
      );
      if (filtro === "pendiente" && !employeeId) avisarContador(pagina);
    } catch {
      if (numero !== peticion.current) return;
      setErrorCola(
        "No se pudo actualizar la cola. Lo que ves puede estar desactualizado; toca Reintentar.",
      );
    } finally {
      if (numero === peticion.current) setCargando(false);
    }
  }, [avisarContador]);

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

  async function cargarMas() {
    if (!cursor || cargandoMas) return;
    const { estado: filtro, modelo: employeeId } = filtroRef.current;
    const numero = peticion.current;
    setCargandoMas(true);
    try {
      const respuesta = await pedirConSesion(
        rutaDeLaCola({ estado: filtro, employeeId, cursor }),
        { cache: "no-store" },
      );
      if (!respuesta.ok) throw new Error(`cola ${respuesta.status}`);
      const pagina = (await respuesta.json()) as ColaDePosts;
      // Si mientras tanto cambio el filtro, esta pagina ya no es de esta lista.
      if (numero !== peticion.current) return;
      setPosts((actual) => unirCola(actual, pagina.items));
      setCursor(pagina.nextCursor);
      setModelos((conocidas) => modelosDeLaCola(pagina.items, conocidas));
    } catch {
      setErrorCola("No se pudieron cargar más publicaciones. Toca Reintentar.");
    } finally {
      setCargandoMas(false);
    }
  }

  // Filtro nuevo: se relee en seguida.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    setAviso(null);
    programarRelectura(0);
  }, [estado, modelo, programarRelectura]);

  const alEvento = useCallback(
    (evento: JefeRealtimeEvent) => {
      const plan = queRecargarPorEvento(evento, filtroRef.current.estado);
      if (plan?.cola) programarRelectura();
    },
    [programarRelectura],
  );

  const alConectar = useCallback(() => programarRelectura(), [programarRelectura]);

  useJefeRealtime({ onEvent: alEvento, onConnected: alConectar });

  // La aplicacion instalada vuelve del bolsillo con el canal dormido.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState === "visible") alConectar();
    }
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [alConectar]);

  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), TICK_DEL_RELOJ_MS);
    return () => {
      clearInterval(reloj);
      if (recarga.current) clearTimeout(recarga.current);
    };
  }, []);

  // Tras abrir otra publicacion a proposito, el foco va a su titulo.
  useEffect(() => {
    if (!enfocarTitulo.current) return;
    enfocarTitulo.current = false;
    const titulo = tituloRef.current;
    if (!titulo) return;
    titulo.focus({ preventScroll: true });
    // `scrollIntoView` y no `window.scrollTo`: en el panel de admin el que hace
    // scroll es el `<main>`, no la ventana.
    titulo.scrollIntoView({ block: "start" });
  }, [abiertoId, vistaMovil]);

  const abierto = posts.find((p) => p.id === abiertoId) ?? null;

  function abrir(post: PostDelEquipo) {
    setAbiertoId(post.id);
    setVistaMovil("revision");
    setAviso(null);
    enfocarTitulo.current = true;
  }

  function volverALaCola() {
    const id = abiertoId;
    setVistaMovil("cola");
    // El foco vuelve a la fila de la que se salio.
    requestAnimationFrame(() => {
      if (id) document.getElementById(`${idBase}-fila-${id}`)?.focus();
    });
  }

  function marcarRevisada(postId: string, mediaId: string) {
    setRevisadas((actual) => {
      const lista = actual[postId] ?? [];
      return lista.includes(mediaId) ? actual : { ...actual, [postId]: [...lista, mediaId] };
    });
  }

  function alDecidir(accion: AccionDelPost, actualizado: PostDelEquipo) {
    const siguiente = siguienteTrasQuitar(posts, actualizado.id);
    const restantes = posts.filter((p) => p.id !== actualizado.id);
    setPosts(restantes);
    setAbiertoId(siguiente);
    setRevisadas((actual) => {
      const resto = { ...actual };
      delete resto[actualizado.id];
      return resto;
    });
    setAviso({
      texto: siguiente ? `${HECHO[accion]} Sigue la próxima de la cola.` : HECHO[accion],
      tono: "ok",
    });
    if (siguiente) {
      enfocarTitulo.current = true;
    } else {
      setVistaMovil("cola");
    }
    // Con la cola sin filtro, la insignia de la navegacion se corrige ya.
    if (filtroRef.current.estado === "pendiente" && !filtroRef.current.modelo) {
      avisarContador({ items: restantes, nextCursor: cursor });
    }
  }

  function alConflicto(mensaje: string) {
    setAviso({ texto: mensaje, tono: "conflicto" });
    programarRelectura(0);
  }

  const etiquetaDelFiltro = FILTROS_DE_LA_COLA.find((f) => f.valor === estado)?.etiqueta ?? "";
  const modeloId = `${idBase}-modelo`;
  const filtrado = estado !== ESTADO_POR_DEFECTO || Boolean(modelo);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-start lg:gap-6">
      <section
        aria-label="Cola de publicaciones"
        className={`${vistaMovil === "cola" ? "block" : "hidden"} overflow-hidden rounded-xl border border-zinc-800 bg-black lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain`}
      >
        <header className="space-y-3 border-b border-zinc-800 px-3 py-3">
          {encabezado}
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C5A55A]">
                Feed
              </p>
              <h1 className="font-heading text-2xl font-semibold text-white">Publicaciones</h1>
            </div>
            <p className="text-right text-xs tabular-nums text-zinc-500">
              {posts.length}
              {cursor ? "+" : ""}
              <span className="block">{etiquetaDelFiltro.toLowerCase()}</span>
            </p>
          </div>

          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
            {FILTROS_DE_LA_COLA.map(({ valor, etiqueta }) => {
              const activo = valor === estado;
              return (
                <button
                  key={valor}
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

          {modelos.length > 1 || modelo ? (
            <div className="space-y-1">
              <label htmlFor={modeloId} className="block text-[11px] font-semibold text-zinc-400">
                Modelo
              </label>
              <select
                id={modeloId}
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-base text-zinc-200 outline-none focus:border-[#C5A55A]/70 sm:text-sm"
              >
                <option value="">Todas</option>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {errorCola ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 flex-1 text-xs text-red-400">
                {errorCola}
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

        {/* Una sola region viva para lo que pasa al decidir: exito o conflicto. */}
        <p
          role="status"
          className={
            aviso
              ? `border-b px-3 py-2.5 text-xs leading-relaxed ${
                  aviso.tono === "ok"
                    ? "border-zinc-800 text-[#E8D5A3]"
                    : "border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#E8D5A3]"
                }`
              : "sr-only"
          }
        >
          {aviso?.texto ?? ""}
        </p>

        <div aria-busy={cargando}>
          {cargando && posts.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-6 py-16 text-xs text-zinc-500">
              <Loader2
                aria-hidden="true"
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
              />
              Cargando publicaciones
            </p>
          ) : posts.length > 0 ? (
            <ul>
              {posts.map((p) => (
                <FilaPublicacion
                  key={p.id}
                  post={p}
                  domId={`${idBase}-fila-${p.id}`}
                  seleccionada={p.id === abiertoId}
                  ahora={ahora}
                  onAbrir={() => abrir(p)}
                />
              ))}
            </ul>
          ) : (
            <div className="px-6 py-16 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 text-zinc-600">
                <ImageIcon aria-hidden="true" size={20} />
              </span>
              <p className="mt-4 text-sm font-medium text-zinc-300">
                {estado === "pendiente"
                  ? "No hay publicaciones por revisar"
                  : `No hay publicaciones ${etiquetaDelFiltro.toLowerCase()}`}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                {filtrado
                  ? "Cambia el filtro para ver otras."
                  : "Cuando una modelo a tu cargo envíe una publicación aparecerá aquí, la más antigua primero."}
              </p>
            </div>
          )}

          {cursor ? (
            <div className="border-t border-zinc-900 p-3">
              <button
                type="button"
                onClick={() => void cargarMas()}
                disabled={cargandoMas}
                aria-busy={cargandoMas}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300 hover:border-[#C5A55A]/60 hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-60"
              >
                {cargandoMas ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                Cargar más
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <div className={`${vistaMovil === "revision" ? "block" : "hidden"} min-w-0 lg:block`}>
        {abierto ? (
          <RevisionDePublicacion
            key={abierto.id}
            post={abierto}
            tituloRef={tituloRef}
            revisadas={new Set(revisadas[abierto.id] ?? [])}
            onRevisada={(mediaId) => marcarRevisada(abierto.id, mediaId)}
            onDecidido={alDecidir}
            onConflicto={alConflicto}
            onVolver={volverALaCola}
            barraClassName={barraClassName}
          />
        ) : (
          <section className="hidden flex-col items-center justify-center rounded-xl border border-zinc-800 px-8 py-24 text-center lg:flex">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-black text-zinc-600">
              <ImageIcon aria-hidden="true" size={22} />
            </span>
            <h2 className="mt-4 font-heading text-2xl text-zinc-300">Elige una publicación</h2>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
              Verás todas sus fotos y videos, el texto completo y podrás aprobarla, rechazarla o
              archivarla.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
