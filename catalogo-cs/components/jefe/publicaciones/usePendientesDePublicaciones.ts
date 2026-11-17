"use client";

import { useEffect, useRef, useState } from "react";

import { pedirConSesion } from "@/lib/client-fetch";
import {
  EVENTO_PENDIENTES_CAMBIARON,
  contarPendientes,
  rutaDeLaCola,
  type ColaDePosts,
} from "@/lib/posts-del-equipo";

/**
 * Lo justo para decir "20+": no hay ruta de conteo y no vale la pena traer la
 * cola entera con su media en cada cambio de pantalla.
 */
const LIMITE_DEL_CONTADOR = 20;
/** Una navegacion seguida de otra no relee la insignia dos veces. */
const ESPERA_MINIMA_MS = 30_000;

export type ContadorDePendientes = { cantidad: number; hayMas: boolean };

/**
 * Pendientes de revision para la insignia de la navegacion del jefe.
 *
 * Se lee al montar, al cambiar de pantalla (con espera minima), al volver a la
 * app y cuando la cola avisa por `EVENTO_PENDIENTES_CAMBIARON` tras decidir o
 * releer. No abre un canal en vivo propio: la cola ya tiene el suyo y un
 * segundo `EventSource` por pestaña solo para la insignia no compensa.
 * `null` mientras no se sabe o si fallo: sin dato no se pinta nada.
 */
export function usePendientesDePublicaciones(ruta: string | null): ContadorDePendientes | null {
  const [contador, setContador] = useState<ContadorDePendientes | null>(null);
  const ultima = useRef(0);

  useEffect(() => {
    let vivo = true;

    async function leer(forzar = false) {
      const momento = Date.now();
      if (!forzar && momento - ultima.current < ESPERA_MINIMA_MS) return;
      ultima.current = momento;
      try {
        const respuesta = await pedirConSesion(rutaDeLaCola({ limit: LIMITE_DEL_CONTADOR }), {
          cache: "no-store",
        });
        if (!respuesta.ok) return;
        const pagina = (await respuesta.json()) as ColaDePosts;
        if (vivo) setContador(contarPendientes(pagina));
      } catch {
        // La insignia es una ayuda: si falla se queda como estaba.
      }
    }

    void leer();

    function alVolver() {
      if (document.visibilityState === "visible") void leer(true);
    }
    function alCambiar(evento: Event) {
      const detalle = (evento as CustomEvent<ContadorDePendientes>).detail;
      if (detalle && typeof detalle.cantidad === "number") {
        ultima.current = Date.now();
        // La cola lee paginas de 50: su cuenta es mas fina que la de aqui.
        setContador({ cantidad: detalle.cantidad, hayMas: Boolean(detalle.hayMas) });
      }
    }
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener(EVENTO_PENDIENTES_CAMBIARON, alCambiar);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener(EVENTO_PENDIENTES_CAMBIARON, alCambiar);
    };
  }, [ruta]);

  return contador;
}
