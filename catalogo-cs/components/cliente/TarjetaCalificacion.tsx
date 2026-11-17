import { Star } from "lucide-react";

import { textoDeCalificacion, type PerfilCliente } from "@/lib/perfil-cliente";
import TarjetaDePerfil from "./TarjetaDePerfil";

/**
 * Calificacion que las modelos le dan al cliente.
 *
 * La estrella es decoracion: la cifra y la cantidad van en texto, y el lector
 * de pantalla recibe la frase completa ("4,5 de 5, 12 calificaciones") en vez
 * de trozos sueltos. Sin calificaciones suficientes no se dibuja ninguna
 * estrella ni un cero, que se leerian como una mala nota.
 */
export default function TarjetaCalificacion({
  calificacion,
}: {
  calificacion: PerfilCliente["calificacion"];
}) {
  const texto = textoDeCalificacion(calificacion);

  return (
    <TarjetaDePerfil id="perfil-calificacion" titulo="Tu calificación">
      {texto.suficiente ? (
        <>
          <p className="flex items-center gap-2">
            <Star
              aria-hidden="true"
              className="h-7 w-7 shrink-0 fill-[#D4AF37] text-[#D4AF37]"
            />
            <span className="sr-only">{texto.accesible}</span>
            <span aria-hidden="true" className="flex items-baseline gap-1.5">
              <span className="font-heading text-4xl font-semibold text-white">
                {texto.cifra}
              </span>
              <span className="text-sm text-zinc-500">de 5</span>
            </span>
          </p>
          <p aria-hidden="true" className="mt-1 text-xs text-zinc-400">
            {texto.detalle}
          </p>
        </>
      ) : (
        <>
          <p className="font-heading text-xl font-semibold text-[#E8D5A3]">
            {texto.titulo}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{texto.detalle}</p>
        </>
      )}
    </TarjetaDePerfil>
  );
}
