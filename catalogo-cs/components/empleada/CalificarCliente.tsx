"use client";

import { useCallback } from "react";
import { UserCheck } from "lucide-react";

import CalificarPendientes from "@/components/ui/CalificarPendientes";
import {
  calificarCliente,
  getClientesPorCalificar,
  type ClientePorCalificar,
} from "@/lib/actions/employee-portal";

/**
 * Calificar al cliente de un servicio ya terminado.
 *
 * El endpoint y el botón del chat existían desde antes, pero el portal no tenía
 * de dónde sacar qué servicio calificar, así que la opción no aparecía por
 * ningún lado. El efecto es que el expediente de un cliente problemático
 * llegaba vacío a quien tiene que decidir si se le vuelve a atender: la nota de
 * la modelo es la única fuente que hay sobre cómo se comportó.
 */
export default function CalificarCliente({ token }: { token?: string }) {
  const cargar = useCallback(() => getClientesPorCalificar(token), [token]);
  const calificar = useCallback(
    (
      item: ClientePorCalificar,
      { stars, comment }: { stars: number; comment: string },
    ) => calificarCliente({ servicioId: item.servicioId, stars, comment }, token),
    [token],
  );

  return (
    <CalificarPendientes
      titulo="Califica a tus clientes"
      icono={<UserCheck size={15} className="text-[#E8D5A3]" />}
      descripcion="Tu calificación es lo único que queda registrado sobre cómo se portó. Sirve para decidir si se le vuelve a atender."
      cargar={cargar}
      calificar={calificar}
      describir={(item) => ({
        id: item.servicioId,
        titulo: item.clienteNombre || "Cliente",
        fecha: item.fecha,
      })}
    />
  );
}
