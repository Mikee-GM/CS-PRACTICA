"use client";

import { useEffect, useRef } from "react";

/**
 * Comportamiento de teclado y foco que un dialogo modal dibujado a mano no trae
 * de fabrica.
 *
 * El `<dialog>` nativo con `showModal()` resuelve esto solo, pero varios
 * modales del panel son capas animadas con framer-motion que se montan y
 * desmontan por estado, y convertirlos exigiria rehacer su animacion de salida.
 * Este hook les da lo imprescindible sin tocar su estructura: Esc cierra, el
 * foco entra al abrir, Tab no escapa a la pagina de detras y al cerrar el foco
 * vuelve al boton que lo abrio.
 *
 * Los modales pueden anidarse (el detalle de un servicio abre el dialogo de
 * cancelacion). Por eso hay una pila: solo el de encima atiende Esc y Tab, y
 * un solo Esc cierra una sola capa.
 */
const pila: symbol[] = [];

const FOCALIZABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focalizables(contenedor: HTMLElement): HTMLElement[] {
  return Array.from(contenedor.querySelectorAll<HTMLElement>(FOCALIZABLES)).filter(
    // Un elemento oculto con `display: none` no tiene cajas y no puede recibir foco.
    (elemento) => elemento.getClientRects().length > 0,
  );
}

export function useModalAccesible<T extends HTMLElement>({
  activo = true,
  bloqueado = false,
  onCerrar,
}: {
  /** Falso cuando el componente sigue montado pero el modal esta cerrado. */
  activo?: boolean;
  /** Mientras hay una peticion en curso no se deja cerrar con Esc. */
  bloqueado?: boolean;
  onCerrar: () => void;
}) {
  const contenedor = useRef<T>(null);
  const cerrar = useRef(onCerrar);
  const impedirCierre = useRef(bloqueado);

  useEffect(() => {
    cerrar.current = onCerrar;
    impedirCierre.current = bloqueado;
  }, [onCerrar, bloqueado]);

  useEffect(() => {
    if (!activo) return;
    const nodo = contenedor.current;
    if (!nodo) return;

    const marca = Symbol("modal");
    pila.push(marca);
    const anterior =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Un `autoFocus` del propio formulario ya colocó el foco: no se le quita.
    if (!nodo.contains(document.activeElement)) {
      const [primero] = focalizables(nodo);
      if (primero) {
        primero.focus();
      } else {
        nodo.tabIndex = -1;
        nodo.focus();
      }
    }

    const alPulsar = (evento: KeyboardEvent) => {
      if (pila[pila.length - 1] !== marca) return;

      if (evento.key === "Escape") {
        if (impedirCierre.current || evento.defaultPrevented) return;
        evento.preventDefault();
        cerrar.current();
        return;
      }

      if (evento.key !== "Tab") return;
      const lista = focalizables(nodo);
      if (lista.length === 0) {
        evento.preventDefault();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const actual = document.activeElement;
      if (evento.shiftKey && (actual === primero || !nodo.contains(actual))) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && (actual === ultimo || !nodo.contains(actual))) {
        evento.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener("keydown", alPulsar);
    return () => {
      document.removeEventListener("keydown", alPulsar);
      const posicion = pila.indexOf(marca);
      if (posicion >= 0) pila.splice(posicion, 1);
      // Si el boton que lo abrio ya no existe, no hay a donde devolver el foco.
      if (anterior && anterior.isConnected) anterior.focus();
    };
  }, [activo]);

  return contenedor;
}
