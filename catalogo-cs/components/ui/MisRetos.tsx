import { Trophy } from "lucide-react";

import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/locale";
import { formatCurrency } from "@/lib/calculations";
import {
  ETIQUETA_DE_METRICA,
  type MetricaDeReto,
  type RetoDelPersonal,
} from "@/lib/retos-del-personal";

/**
 * Lista de retos de la persona, generica para empleada y chofer: recibe los
 * datos ya cargados y no depende de ningun portal. Muestra su posicion y el
 * top 3 con nombres, no a todas las participantes.
 */

type Props = {
  retos: RetoDelPersonal[];
  titulo?: string;
};

const fechaDeCierre = (iso: string) =>
  new Date(iso).toLocaleDateString(APP_LOCALE, {
    day: "numeric",
    month: "long",
    timeZone: APP_TIME_ZONE,
  });

const valorDeMetrica = (metrica: MetricaDeReto, valor: number) => {
  if (metrica === "revenue") return formatCurrency(valor);
  if (metrica === "kpi_score") return `${valor} pts`;
  return String(valor);
};

export default function MisRetos({ retos, titulo = "Mis retos" }: Props) {
  return (
    <section aria-label={titulo} className="space-y-4">
      <h2 className="font-heading text-2xl text-[#E8D5A3]">{titulo}</h2>

      {retos.length === 0 ? (
        <p className="rounded-xl border border-[#8B7635]/30 bg-[#0A0A0A] p-6 text-center text-sm text-zinc-400">
          No tienes retos activos
        </p>
      ) : (
        <ul className="space-y-4">
          {retos.map((reto) => (
            <li
              key={reto.id}
              className="space-y-3 rounded-xl border border-[#8B7635]/30 bg-[#0A0A0A] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-heading text-lg text-[#E8D5A3]">
                    {reto.title}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {ETIQUETA_DE_METRICA[reto.metric]}
                    {reto.status === "active"
                      ? ` · Termina el ${fechaDeCierre(reto.endsAt)}`
                      : ` · Terminó el ${fechaDeCierre(reto.endsAt)}`}
                  </p>
                </div>
                {reto.gane ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#D4AF37] px-2 py-1 text-xs text-[#D4AF37]">
                    <Trophy className="size-3" aria-hidden="true" />
                    Ganaste
                  </span>
                ) : null}
              </div>

              <p className="text-sm text-zinc-200">
                {reto.miPosicion != null
                  ? `Vas en el lugar ${reto.miPosicion} de ${reto.participantes} con ${valorDeMetrica(reto.metric, reto.miValor)}`
                  : `Participan ${reto.participantes}`}
              </p>

              <ol className="space-y-1">
                {reto.top.map((puesto) => (
                  <li
                    key={puesto.posicion}
                    className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                      puesto.esMio
                        ? "bg-[#C5A55A]/15 text-[#E8D5A3]"
                        : "bg-[#050505] text-zinc-300"
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      {puesto.posicion}. {puesto.esMio ? "Tú" : puesto.nombre}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {valorDeMetrica(reto.metric, puesto.valor)}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
