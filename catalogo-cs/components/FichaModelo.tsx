import CustomerRating from "@/components/ui/CustomerRating";
import { availabilityLabel } from "@/lib/availability";
import type { Modelo } from "@/types";

/**
 * Disponibilidad efectiva de una modelo y si se le puede escribir.
 *
 * La comparten el modal del catalogo y el perfil publico: si cada uno la
 * dedujera por su lado, uno ofreceria "Chatear" donde el otro dice "Ocupada".
 */
export function estadoDeContacto(modelo: Modelo) {
  const status = availabilityLabel(modelo);
  const effectiveStatus =
    modelo.availabilityStatus ??
    (modelo.disponible ? "disponible" : "ocupada");
  const canContact =
    effectiveStatus === "disponible" ||
    (effectiveStatus === "ocupada" && modelo.canScheduleNext !== false);
  return { status, effectiveStatus, canContact };
}

/**
 * Datos publicos de la ficha: calificacion, disponibilidad, descripcion y
 * servicios extra. Sin el nombre, que cada pantalla pinta con su propio nivel
 * de encabezado (un `h2` dentro del modal, el `h1` del perfil).
 *
 * Sin `"use client"`: el modal la usa dentro de su arbol cliente y el perfil la
 * renderiza en el servidor, dentro del HTML prerenderizado.
 */
export default function FichaModelo({
  modelo,
  nivelDeTitulo = "h3",
}: {
  modelo: Modelo;
  /** Un nivel por debajo del nombre, para no saltar niveles en el esquema. */
  nivelDeTitulo?: "h2" | "h3";
}) {
  const { status, effectiveStatus } = estadoDeContacto(modelo);
  const Titulo = nivelDeTitulo;

  return (
    <>
      {modelo.clientRatingAverage != null && (modelo.clientRatingCount ?? 0) > 0 && (
        <div className="mb-5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Calificación de clientes
          </p>
          <CustomerRating
            average={modelo.clientRatingAverage}
            count={modelo.clientRatingCount}
          />
        </div>
      )}
      <div className="mb-6">
        <span className="text-[9px] font-light uppercase tracking-[0.25em] text-zinc-500 block mb-1.5">
          Disponibilidad
        </span>
        <div className="inline-flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              effectiveStatus === "disponible"
                ? "bg-[#E8D5A3] shadow-[0_0_8px_rgba(232,213,163,0.8)]"
                : "bg-zinc-500"
            }`}
          />
          <span className="text-xs font-light tracking-[0.25em] uppercase text-[#E8D5A3]">
            {status}
          </span>
        </div>
        {effectiveStatus === "ocupada" &&
          modelo.canScheduleNext !== false && (
            <p className="mt-1.5 text-xs font-light text-zinc-400">
              Puedes solicitar el siguiente turno desde Telegram.
            </p>
          )}
      </div>
      <div className="w-12 h-px bg-[#C5A55A]/60 mb-6" />

      {/* Descripcion con whitespace-pre-wrap para respetar saltos de linea */}
      {modelo.descripcion && (
        <p className="text-sm sm:text-[15px] text-zinc-300 font-light leading-relaxed mb-8 whitespace-pre-wrap">
          {modelo.descripcion}
        </p>
      )}

      {/* Servicios Extra */}
      {modelo.extras && modelo.extras.length > 0 && (
        <div className="mt-6 mb-8">
          <Titulo className="font-heading text-lg font-semibold text-[#C5A55A] tracking-wider mb-3">
            Servicios Extra
          </Titulo>
          <div className="space-y-3 border-t border-zinc-900 pt-3">
            {modelo.extras.map((extra) => (
              <div
                key={extra.id || extra.nombre}
                className="flex items-center justify-between text-xs sm:text-sm text-zinc-300 font-light"
              >
                <span className="font-sans">{extra.nombre}</span>
                <span className="font-mono text-[#E8D5A3] font-medium">${extra.precio}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
