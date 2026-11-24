"use client";

import { AnimatePresence, motion } from "framer-motion";
import { EllipsisVertical, Share, SquarePlus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useModalAccesible } from "@/hooks/useModalAccesible";
import { reclamarDescuentoDeInstalacionAction } from "@/lib/actions/beneficios";
import {
  aplazarHasta,
  CLAVE_DE_APLAZAMIENTO,
  debeMostrarElAnuncio,
  debeReclamar,
  leerAplazamiento,
  type BeneficioDeInstalacion,
} from "@/lib/beneficios-del-cliente";
import { capabilitiesFromBrowser, type PwaCapabilities } from "@/lib/pwa";

interface EventoDeInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Espera antes de mostrar el anuncio, para que la pantalla cargue primero. */
const ESPERA_MS = 1200;

function leerAplazamientoGuardado(): number | null {
  try {
    return leerAplazamiento(window.localStorage.getItem(CLAVE_DE_APLAZAMIENTO));
  } catch {
    return null;
  }
}

/**
 * Anuncio que invita al cliente a instalar la app a cambio de un descuento.
 *
 * Desde el navegador muestra un tutorial con los pasos de su dispositivo. Desde
 * la app instalada --con sesion-- activa el descuento al abrirla: es lo que el
 * navegador permite comprobar (modo `standalone`). En iPhone la app instalada no
 * comparte sesion con Safari, asi que el tutorial pide entrar de nuevo dentro de
 * ella; es ahi donde se activa.
 */
export default function AnuncioDeInstalacionCliente({
  inicial,
}: {
  inicial: BeneficioDeInstalacion;
}) {
  const ruta = usePathname() ?? "";
  const [beneficio, setBeneficio] = useState(inicial);
  const [capacidades, setCapacidades] = useState<PwaCapabilities | null>(null);
  const [evento, setEvento] = useState<EventoDeInstalacion | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    setCapacidades(capabilitiesFromBrowser());
    const alOfrecer = (e: Event) => {
      // Se guarda para ofrecer el cuadro nativo desde nuestro boton.
      e.preventDefault();
      setEvento(e as EventoDeInstalacion);
    };
    const alInstalar = () => {
      setEvento(null);
      setCapacidades(capabilitiesFromBrowser());
    };
    window.addEventListener("beforeinstallprompt", alOfrecer);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", alOfrecer);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  const instalada = capacidades?.installed ?? false;

  // Abrir la app instalada activa el descuento.
  useEffect(() => {
    if (!capacidades || !debeReclamar({ estado: beneficio.estado, instalada })) return;
    let activo = true;
    void reclamarDescuentoDeInstalacionAction().then((r) => {
      if (!activo || !r.success) return;
      setBeneficio(r.data);
      toast.success(`Descuento activado: ${r.data.porcentaje} % en tu siguiente servicio`);
    });
    return () => {
      activo = false;
    };
  }, [capacidades, beneficio.estado, instalada]);

  // Desde el navegador, anunciarlo una vez cargada la pantalla.
  useEffect(() => {
    if (!capacidades) return;
    const mostrar = debeMostrarElAnuncio({
      estado: beneficio.estado,
      instalada,
      ruta,
      aplazadoHasta: leerAplazamientoGuardado(),
      ahora: Date.now(),
    });
    if (!mostrar) {
      setAbierto(false);
      return;
    }
    const t = window.setTimeout(() => setAbierto(true), ESPERA_MS);
    return () => window.clearTimeout(t);
  }, [capacidades, beneficio.estado, instalada, ruta]);

  function posponer() {
    try {
      window.localStorage.setItem(CLAVE_DE_APLAZAMIENTO, String(aplazarHasta(Date.now())));
    } catch {
      // Sin almacenamiento volvera a verse en la proxima visita.
    }
    setAbierto(false);
  }

  async function instalarAhora() {
    if (!evento) return;
    await evento.prompt();
    const eleccion = await evento.userChoice;
    setEvento(null);
    if (eleccion.outcome === "accepted") setAbierto(false);
  }

  return (
    <AnimatePresence>
      {abierto && capacidades ? (
        <Hoja
          key="anuncio"
          porcentaje={beneficio.porcentaje}
          plataforma={capacidades.platform}
          puedeInstalarAqui={evento !== null}
          onInstalar={() => void instalarAhora()}
          onCerrar={posponer}
        />
      ) : null}
    </AnimatePresence>
  );
}

const PASO_FINAL =
  "Abre la app desde su ícono e inicia sesión. El descuento se activa al entrar.";

function Hoja({
  porcentaje,
  plataforma,
  puedeInstalarAqui,
  onInstalar,
  onCerrar,
}: {
  porcentaje: number;
  plataforma: PwaCapabilities["platform"];
  puedeInstalarAqui: boolean;
  onInstalar: () => void;
  onCerrar: () => void;
}) {
  const tituloId = useId();
  const panel = useModalAccesible<HTMLElement>({ onCerrar });
  const ios = plataforma === "ios";

  const pasos: ReactNode[] = ios
    ? [
        "Abre esta página en Safari.",
        <span key="c" className="inline-flex items-center gap-2">
          Toca Compartir <Share aria-hidden="true" className="h-4 w-4 text-[#C5A55A]" />
        </span>,
        <span key="a" className="inline-flex items-center gap-2">
          Elige Agregar a pantalla de inicio{" "}
          <SquarePlus aria-hidden="true" className="h-4 w-4 text-[#C5A55A]" />
        </span>,
        PASO_FINAL,
      ]
    : puedeInstalarAqui
      ? ["Toca Instalar la app.", PASO_FINAL]
      : [
          <span key="m" className="inline-flex items-center gap-2">
            Abre el menú del navegador{" "}
            <EllipsisVertical aria-hidden="true" className="h-4 w-4 text-[#C5A55A]" />
          </span>,
          "Elige Instalar aplicación o Agregar a pantalla principal.",
          PASO_FINAL,
        ];

  return (
    <motion.div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[#C5A55A]/40 bg-zinc-950 p-5"
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 48, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={tituloId} className="font-heading text-2xl font-semibold text-white">
              {porcentaje} % de descuento en tu siguiente servicio
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              Instala la app en tu teléfono: chatea más rápido, sin abrir el navegador, y el
              descuento se activa solo.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition-colors hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <ol className="mt-5 space-y-3 text-sm leading-relaxed text-zinc-200">
          {pasos.map((paso, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#C5A55A]/60 text-xs font-semibold text-[#C5A55A]"
              >
                {i + 1}
              </span>
              <span className="pt-0.5">{paso}</span>
            </li>
          ))}
        </ol>

        <p className="mt-5 text-xs leading-relaxed text-zinc-500">
          Se aplica una sola vez, al precio base de tu siguiente servicio, y vale 60 días desde que
          se activa.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          {puedeInstalarAqui && !ios ? (
            <button
              type="button"
              onClick={onInstalar}
              className="min-h-11 flex-1 rounded-lg bg-[#C5A55A] px-4 text-sm font-semibold text-black transition-colors hover:bg-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8D5A3]"
            >
              Instalar la app
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-11 flex-1 rounded-lg border border-zinc-700 px-4 text-sm font-medium text-zinc-300 transition-colors hover:border-[#C5A55A]/60 hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
          >
            Ahora no
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
