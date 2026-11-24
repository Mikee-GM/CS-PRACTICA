import BotonResincronizar from "@/components/erp/boton-resincronizar";
import { Panel, StatusBadge } from "@/components/erp/primitives";
import type { BloqueTablero } from "@/components/erp/tablero-personalizable";
import { formatCurrency } from "@/lib/calculations";
import {
  gruposDelResumen,
  textoDeEstado,
  VERIFICACIONES_RESINCRONIZABLES,
  type Conciliacion,
  type FilaDelResumen,
  type ResultadoDeVerificacion,
} from "@/lib/conciliacion";

/**
 * El dinero de la semana, completo, y si cuadra.
 *
 * Dos bloques del Centro de Mando. El desglose responde "cuanto entro, como se
 * reparte y cuanto falta por cobrar o pagar". La conciliacion responde "es
 * verdad": cada importe se recalcula desde los servicios y se compara con lo que
 * el sistema guardo en otra parte; una fila marcada es dinero que no cuadra.
 */

const valorDeLaFila = (fila: FilaDelResumen) =>
  fila.tipo === "cantidad" ? String(fila.valor) : formatCurrency(fila.valor);

function DesgloseDelDinero({ conciliacion }: { conciliacion: Conciliacion }) {
  const grupos = gruposDelResumen(conciliacion.resumen);
  const resultado = conciliacion.resumen.resultadoDeLaEmpresa;

  return (
    <Panel
      title="Desglose del dinero"
      subtitle={`Semana del ${conciliacion.desde} al ${conciliacion.hasta}`}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {grupos.map((grupo) => (
          <section key={grupo.id} aria-labelledby={`resumen-${grupo.id}`}>
            <h3
              id={`resumen-${grupo.id}`}
              className="mb-2 font-heading text-sm font-semibold text-[#E8D5A3]"
            >
              {grupo.titulo}
            </h3>
            <dl className="divide-y divide-zinc-800/80 text-sm">
              {grupo.filas.map((fila) => (
                <div
                  key={fila.etiqueta}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <dt className="min-w-0 text-zinc-400">
                    {fila.etiqueta}
                    {fila.ayuda ? (
                      <span className="mt-0.5 block text-xs text-zinc-600">
                        {fila.ayuda}
                      </span>
                    ) : null}
                  </dt>
                  <dd
                    className={`shrink-0 tabular-nums ${
                      fila.tono === "aviso" ? "text-amber-400" : "text-zinc-100"
                    }`}
                  >
                    {valorDeLaFila(fila)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-[#C5A55A]/30 bg-[#C5A55A]/[0.06] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-base font-semibold text-[#E8D5A3]">
            Resultado estimado de la empresa
          </h3>
          <p
            className={`text-xl font-semibold tabular-nums ${
              resultado < 0 ? "text-red-400" : "text-[#E8D5A3]"
            }`}
          >
            {formatCurrency(resultado)}
          </p>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Parte de la empresa, mas el transporte cobrado a clientes, menos lo que se
          paga a choferes y a Uber. No incluye los gastos de la oficina.
        </p>
      </div>
    </Panel>
  );
}

function FilaDeVerificacion({
  verificacion,
}: {
  verificacion: ResultadoDeVerificacion;
}) {
  const ok = verificacion.estado === "ok";
  const resincronizable = VERIFICACIONES_RESINCRONIZABLES.has(verificacion.id);

  return (
    <li className="border-b border-zinc-800/80 last:border-b-0">
      <details className="group" open={!ok}>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C5A55A]/60 sm:px-5">
          <span className="min-w-0 text-zinc-200">{verificacion.titulo}</span>
          {ok ? (
            <StatusBadge tone="green">Cuadra</StatusBadge>
          ) : (
            <StatusBadge tone="red">
              {verificacion.casos === 1 ? "1 caso" : `${verificacion.casos} casos`},{" "}
              {formatCurrency(verificacion.diferenciaTotal)}
            </StatusBadge>
          )}
        </summary>

        <div className="space-y-3 px-4 pb-4 text-sm sm:px-5">
          <p className="text-zinc-500">{verificacion.descripcion}</p>
          {ok ? null : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead className="bg-zinc-900/60 text-zinc-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Referencia</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Esperado</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Guardado</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Diferencia</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Detalle</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Accion</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {verificacion.muestra.map((caso) => (
                    <tr key={`${caso.referencia}-${caso.detalle}`}>
                      <td className="px-3 py-2 text-zinc-300">{caso.referencia}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(caso.esperado)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(caso.real)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-400">
                        {formatCurrency(caso.diferencia)}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{caso.detalle}</td>
                      <td className="px-3 py-2 text-right">
                        {resincronizable && caso.servicioId ? (
                          <BotonResincronizar servicioId={caso.servicioId} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {verificacion.casos > verificacion.muestra.length ? (
                <p className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-500">
                  Se muestran {verificacion.muestra.length} de {verificacion.casos} casos.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function ConciliacionDeDinero({ conciliacion }: { conciliacion: Conciliacion }) {
  const cuadra = conciliacion.estado === "ok";

  return (
    <Panel
      title="Conciliacion del dinero"
      subtitle="Cada importe se recalcula desde los servicios y se compara con lo guardado"
      action={
        <StatusBadge tone={cuadra ? "green" : "red"} dot>
          {textoDeEstado(conciliacion)}
        </StatusBadge>
      }
      flush
    >
      <ul>
        {conciliacion.verificaciones.map((verificacion) => (
          <FilaDeVerificacion key={verificacion.id} verificacion={verificacion} />
        ))}
      </ul>
      <p className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-600 sm:px-5">
        Generada el{" "}
        {new Date(conciliacion.generadoAt).toLocaleString("es-MX", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "America/Mexico_City",
        })}
        .
      </p>
    </Panel>
  );
}

/** Los dos bloques del dinero; si no hubo datos, un aviso en vez de nada. */
export function bloquesDeConciliacion(
  conciliacion: Conciliacion | null,
): BloqueTablero[] {
  if (!conciliacion) {
    return [
      {
        id: "conciliacion-dinero",
        titulo: "Conciliacion del dinero",
        anchoCompleto: true,
        contenido: (
          <Panel title="Conciliacion del dinero">
            <p className="text-sm text-zinc-400">
              No se pudo calcular la conciliacion. Recarga la pagina; si sigue
              fallando, revisa el registro del servidor.
            </p>
          </Panel>
        ),
      },
    ];
  }

  return [
    {
      id: "dinero-desglose",
      titulo: "Desglose del dinero",
      anchoCompleto: true,
      contenido: <DesgloseDelDinero conciliacion={conciliacion} />,
    },
    {
      id: "conciliacion-dinero",
      titulo: "Conciliacion del dinero",
      anchoCompleto: true,
      contenido: <ConciliacionDeDinero conciliacion={conciliacion} />,
    },
  ];
}
