"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Movimiento del chat.
 *
 * Criterio: el movimiento responde a una accion de la persona --enviar, recibir,
 * que aparezca un error-- y nunca decora la carga. Por eso el historial que ya
 * estaba al abrir la conversacion no se anima: solo lo que llega o se envia con
 * la conversacion abierta.
 *
 * Todo respeta "reducir movimiento" del sistema: `ProveedorMovimiento` apaga las
 * transformaciones (desplazar, escalar) y deja solo los cambios de opacidad.
 */

/** Respeta la preferencia del sistema en toda la aplicacion. */
export function ProveedorMovimiento({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export type LadoDelMensaje = "izquierda" | "derecha" | "centro";

const RESORTE = { type: "spring", stiffness: 380, damping: 30, mass: 0.9 } as const;

const DESPLAZAMIENTO: Record<LadoDelMensaje, number> = {
  izquierda: -14,
  derecha: 14,
  centro: 0,
};

const ORIGEN: Record<LadoDelMensaje, string> = {
  izquierda: "0% 100%",
  derecha: "100% 100%",
  centro: "50% 100%",
};

/**
 * Un mensaje de la lista. Entra desde su lado, con un pequeño resorte, hacia la
 * esquina de donde sale la burbuja. Con `animar` falso se pinta ya en su sitio.
 */
export function ItemMensaje({
  lado,
  animar,
  className,
  children,
}: {
  lado: LadoDelMensaje;
  animar: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.li
      className={className}
      style={{ transformOrigin: ORIGEN[lado] }}
      initial={
        animar
          ? { opacity: 0, y: 12, x: DESPLAZAMIENTO[lado], scale: 0.96 }
          : false
      }
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{ ...RESORTE, opacity: { duration: 0.18 } }}
    >
      {children}
    </motion.li>
  );
}

/** Sacudida corta de una burbuja cuando el envio falla. */
export const SACUDIDA_DE_ERROR = { x: [0, -5, 5, -4, 4, 0] };

/**
 * Cambio de estado debajo de una burbuja (enviando, hora, error): se funde en
 * vez de cambiar de golpe. `clave` identifica el estado actual.
 */
export function EstadoAnimado({
  clave,
  className,
  children,
}: {
  clave: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={clave}
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/**
 * "Fulana esta escribiendo", con tres puntos dorados que laten escalonados.
 *
 * El contenedor es el `role="status"`: el lector de pantalla anuncia solo el
 * texto, los puntos son decorativos. Reserva su altura para que la lista no
 * salte al aparecer.
 */
export function IndicadorEscribiendo({
  visible,
  texto,
}: {
  visible: boolean;
  texto: string;
}) {
  return (
    <p role="status" className="min-h-7 px-2">
      <AnimatePresence initial={false}>
        {visible ? (
          <motion.span
            key="escribiendo"
            className="inline-flex items-center gap-2 text-xs text-zinc-500"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
          >
            <span
              aria-hidden="true"
              className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-[#0A0A0A] px-2.5 py-2"
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-[#C5A55A]"
                  animate={{ opacity: [0.35, 1, 0.35], y: [0, -2, 0] }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.16,
                  }}
                />
              ))}
            </span>
            <span>{texto}</span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </p>
  );
}
