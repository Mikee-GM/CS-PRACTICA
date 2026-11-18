"use client";

import { useCallback } from "react";
import { Car } from "lucide-react";

import CalificarPendientes from "@/components/ui/CalificarPendientes";
import {
  calificarChofer,
  getChoferesPorCalificar,
  type ChoferPorCalificar,
} from "@/lib/actions/employee-portal";

/**
 * Calificar al chofer de un viaje ya terminado.
 *
 * Es la contraparte de la calificacion del cliente: la modelo es quien va en
 * el coche, asi que su palabra es la unica fuente sobre el trato y la
 * puntualidad que recibio. Solo se monta con sesion propia, porque las rutas
 * nuevas piden cookie.
 */
export default function CalificarChofer() {
  const calificar = useCallback(
    (
      item: ChoferPorCalificar,
      { stars, comment }: { stars: number; comment: string },
    ) => calificarChofer({ viajeId: item.viajeId, stars, comment }),
    [],
  );

  return (
    <CalificarPendientes
      titulo="Califica a tus choferes"
      icono={<Car size={15} className="text-[#E8D5A3]" />}
      descripcion="Cuenta cómo fue el viaje. Tu opinión ayuda a decidir qué choferes siguen asignados."
      cargar={getChoferesPorCalificar}
      calificar={calificar}
      describir={(item) => ({
        id: item.viajeId,
        titulo: item.choferNombre || "Chofer",
        fecha: item.fecha,
      })}
    />
  );
}
