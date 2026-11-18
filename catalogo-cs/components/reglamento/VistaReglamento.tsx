import type { ReactNode } from "react";

import {
  estadoVisible,
  TEXTO_DE_ESTADO,
  type MiReglamento,
} from "@/lib/reglamento";
import Cuestionario from "./Cuestionario";

/**
 * Reglamento del rol y su cuestionario.
 *
 * El contenido es texto plano que escribe el administrador: se pinta con
 * `whitespace-pre-line` y nunca como HTML, asi un reglamento con marcas no
 * puede inyectar nada en la pagina.
 */
export default function VistaReglamento({
  datos,
}: {
  /** `null` cuando la lectura fallo: se avisa en lugar de decir que no hay. */
  datos: MiReglamento | null;
}) {
  if (!datos) {
    return (
      <Mensaje>
        No se pudo cargar el reglamento. Recarga la página en unos segundos.
      </Mensaje>
    );
  }
  if (!datos.reglamento) {
    return <Mensaje>No hay reglamento publicado para tu rol.</Mensaje>;
  }

  const { reglamento, cuestionario } = datos;
  const estado = estadoVisible(cuestionario);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl font-semibold text-white">
          {reglamento.titulo}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={
              estado === "aprobado"
                ? "rounded-full border border-[#C5A55A]/50 bg-[#C5A55A]/10 px-3 py-1 font-semibold text-[#E8D5A3]"
                : "rounded-full border border-zinc-700 px-3 py-1 font-semibold text-zinc-300"
            }
          >
            {TEXTO_DE_ESTADO[estado]}
          </span>
          <span className="text-zinc-500">
            Puntaje mínimo para aprobar: {reglamento.puntajeMinimo}
          </span>
        </div>
      </header>

      <article className="whitespace-pre-line rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-4 text-sm leading-relaxed text-zinc-300 sm:p-5">
        {reglamento.contenido}
      </article>

      {cuestionario ? (
        <Cuestionario
          cuestionario={cuestionario}
          puntajeMinimo={reglamento.puntajeMinimo}
        />
      ) : null}
    </div>
  );
}

function Mensaje({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-6 text-center text-sm text-zinc-400">
      {children}
    </div>
  );
}
