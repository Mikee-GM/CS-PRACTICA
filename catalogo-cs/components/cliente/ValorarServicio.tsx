"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { categoryLabels } from "@/components/employee-reports/report-labels";
import {
  calificarServicioAction,
  reportarServicioAction,
  volverAContratarAction,
} from "@/lib/actions/valoracion-del-servicio";
import { pedirConSesion } from "@/lib/client-fetch";
import { esRedireccion } from "@/lib/es-redireccion";
import type { EmployeeReportCategory } from "@/lib/types";
import {
  categoriasDisponibles,
  MOTIVOS,
  pideMotivo,
  type ModeloPorValorar,
  type MotivoDeCalificacion,
  type ServicioPorValorar,
} from "@/lib/valoracion-del-servicio";
import { botonPrimario, ErrorDeFormulario, ExitoDeFormulario } from "./Campo";

const campoDeTexto =
  "w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-[#C5A55A]/60 focus:outline-none focus:ring-4 focus:ring-[#C5A55A]/10";

const botonSecundario =
  "min-h-11 rounded-lg border border-[#C5A55A]/50 px-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-50";

const CONFIRMACION_ENVIADA = "Gracias, tu calificación quedó registrada.";

/** Estrellas de una modelo: un grupo de botones, no cinco controles sueltos. */
function Estrellas({
  nombre,
  valor,
  bloqueado,
  onElegir,
}: {
  nombre: string;
  valor: number;
  bloqueado: boolean;
  onElegir: (estrellas: number) => void;
}) {
  return (
    <div role="group" aria-label={`Estrellas para ${nombre}`} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={bloqueado}
          aria-pressed={valor === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          onClick={() => onElegir(n)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:cursor-default"
        >
          <Star
            aria-hidden="true"
            className={`h-6 w-6 ${
              n <= valor ? "fill-[#C5A55A] text-[#C5A55A]" : "text-zinc-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function FilaDeModelo({
  servicio,
  modelo,
  onCalificada,
}: {
  servicio: ServicioPorValorar;
  modelo: ModeloPorValorar;
  onCalificada: (modeloId: string, estrellas: number) => void;
}) {
  const id = useId();
  const [estrellas, setEstrellas] = useState(modelo.estrellas ?? 0);
  const [motivo, setMotivo] = useState<MotivoDeCalificacion | null>(null);
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [pendiente, startTransition] = useTransition();
  const calificada = modelo.estrellas !== null;

  function enviar() {
    if (estrellas < 1) {
      setError("Elige de 1 a 5 estrellas.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const resultado = await calificarServicioAction(servicio.servicioId, {
          estrellas,
          // Sin empleadaId el backend califica a la modelo principal.
          empleadaId: modelo.id,
          ...(pideMotivo(estrellas) && motivo ? { motivo } : {}),
          ...(comentario.trim() ? { comentario } : {}),
        });
        if (!resultado.success) {
          setError(resultado.error);
          return;
        }
        // Si ya existia, el backend devuelve la primera: se muestra esa.
        setEstrellas(resultado.data.estrellas);
        setExito(CONFIRMACION_ENVIADA);
        onCalificada(modelo.id, resultado.data.estrellas);
      } catch (e) {
        if (esRedireccion(e)) throw e;
        setError("No se pudo enviar la calificación. Revisa tu conexión y vuelve a intentarlo.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-white">{modelo.nombreArtistico}</p>
      <Estrellas
        nombre={modelo.nombreArtistico}
        valor={estrellas}
        bloqueado={calificada || pendiente}
        onElegir={setEstrellas}
      />

      {!calificada && estrellas >= 1 ? (
        <div className="space-y-3">
          {pideMotivo(estrellas) ? (
            <div role="group" aria-labelledby={`${id}-motivo`} className="space-y-2">
              <p
                id={`${id}-motivo`}
                className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400"
              >
                Qué podemos mejorar
              </p>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS.map((m) => (
                  <button
                    key={m.valor}
                    type="button"
                    aria-pressed={motivo === m.valor}
                    onClick={() => setMotivo(motivo === m.valor ? null : m.valor)}
                    className={`min-h-11 rounded-full border px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 ${
                      motivo === m.valor
                        ? "border-[#C5A55A] bg-[#C5A55A] text-black"
                        : "border-zinc-800 text-zinc-300 hover:border-[#C5A55A]/50"
                    }`}
                  >
                    {m.etiqueta}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label
              htmlFor={`${id}-comentario`}
              className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400"
            >
              Comentario (opcional)
            </label>
            <textarea
              id={`${id}-comentario`}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              maxLength={2000}
              rows={2}
              className={campoDeTexto}
            />
          </div>

          <button type="button" onClick={enviar} disabled={pendiente} className={botonPrimario}>
            {pendiente ? "Enviando" : "Enviar calificación"}
          </button>
        </div>
      ) : null}

      {calificada && !exito ? (
        <p className="text-xs text-zinc-500">Ya calificaste este servicio.</p>
      ) : null}
      <ErrorDeFormulario mensaje={error} />
      <ExitoDeFormulario mensaje={exito} />
    </div>
  );
}

function ReportarProblema({
  servicio,
  onReportado,
}: {
  servicio: ServicioPorValorar;
  onReportado: (categoria: EmployeeReportCategory) => void;
}) {
  const id = useId();
  const disponibles = categoriasDisponibles(servicio);
  const [abierto, setAbierto] = useState(false);
  const [categoria, setCategoria] = useState<EmployeeReportCategory | "">("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [pendiente, startTransition] = useTransition();

  function enviar() {
    if (!categoria) {
      setError("Elige el tipo de problema.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const resultado = await reportarServicioAction(servicio.servicioId, {
          categoria,
          descripcion,
        });
        if (!resultado.success) {
          setError(resultado.error);
          return;
        }
        setExito("Recibimos tu reporte. El equipo lo revisará.");
        setCategoria("");
        setDescripcion("");
        setAbierto(false);
        onReportado(categoria);
      } catch (e) {
        if (esRedireccion(e)) throw e;
        setError("No se pudo enviar el reporte. Revisa tu conexión y vuelve a intentarlo.");
      }
    });
  }

  return (
    <div className="space-y-2">
      {disponibles.length > 0 && !abierto ? (
        <button type="button" onClick={() => setAbierto(true)} className={botonSecundario}>
          Reportar un problema
        </button>
      ) : null}

      {abierto ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor={`${id}-categoria`}
              className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400"
            >
              Tipo de problema
            </label>
            <select
              id={`${id}-categoria`}
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as EmployeeReportCategory | "")}
              className={campoDeTexto}
            >
              <option value="">Elige una opción</option>
              {disponibles.map((c) => (
                <option key={c} value={c}>
                  {categoryLabels[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`${id}-descripcion`}
              className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400"
            >
              Qué pasó
            </label>
            <textarea
              id={`${id}-descripcion`}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              minLength={3}
              maxLength={2000}
              rows={3}
              className={campoDeTexto}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={enviar} disabled={pendiente} className={botonSecundario}>
              {pendiente ? "Enviando" : "Enviar reporte"}
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              disabled={pendiente}
              className="min-h-11 rounded-lg px-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <ErrorDeFormulario mensaje={error} />
      <ExitoDeFormulario mensaje={exito} />
    </div>
  );
}

function TarjetaDeServicio({
  servicio,
  empleadaId,
  onCambio,
}: {
  servicio: ServicioPorValorar;
  empleadaId: string;
  onCambio: (servicio: ServicioPorValorar) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();
  // El chat abierto es el de una modelo; si no esta en la lista (no deberia),
  // se ofrece la primera, que es la principal del servicio.
  const modeloDelChat = servicio.modelos.find((m) => m.id === empleadaId) ?? servicio.modelos[0];

  function volverAContratar() {
    setError("");
    startTransition(async () => {
      try {
        const resultado = await volverAContratarAction(servicio.servicioId);
        if (!resultado.success) {
          setError(resultado.error);
          return;
        }
        router.push(`/chats/${resultado.data.id}`);
      } catch (e) {
        if (esRedireccion(e)) throw e;
        setError("No se pudo abrir el chat. Revisa tu conexión y vuelve a intentarlo.");
      }
    });
  }

  return (
    <section
      aria-label="Valora tu servicio"
      className="space-y-4 rounded-xl border border-[#C5A55A]/30 bg-black/40 p-4"
    >
      <h2 className="font-[family-name:var(--font-cormorant)] text-lg font-semibold text-[#E8D5A3]">
        Valora tu servicio
      </h2>

      {servicio.modelos.map((modelo) => (
        <FilaDeModelo
          key={modelo.id}
          servicio={servicio}
          modelo={modelo}
          onCalificada={(modeloId, estrellas) =>
            onCambio({
              ...servicio,
              modelos: servicio.modelos.map((m) => (m.id === modeloId ? { ...m, estrellas } : m)),
            })
          }
        />
      ))}

      <div className="flex flex-wrap items-start gap-2 border-t border-zinc-800 pt-4">
        <ReportarProblema
          servicio={servicio}
          onReportado={(categoria) =>
            onCambio({
              ...servicio,
              categoriasReportadas: [...servicio.categoriasReportadas, categoria],
            })
          }
        />
        {modeloDelChat ? (
          <button
            type="button"
            onClick={volverAContratar}
            disabled={pendiente}
            aria-busy={pendiente}
            className={botonSecundario}
          >
            {pendiente ? "Abriendo chat" : `Volver a contratar a ${modeloDelChat.nombreArtistico}`}
          </button>
        ) : null}
      </div>
      <ErrorDeFormulario mensaje={error} />
    </section>
  );
}

/**
 * Valoracion de los servicios terminados con la modelo de este chat.
 *
 * Lee lo pendiente de `GET /client-feedback/pending`; `recarga` es un contador
 * que `VistaChat` sube cuando llega un aviso en vivo (el servicio acaba de
 * finalizar, o el chat se cerro), para releerlo sin recargar la pagina.
 *
 * En un servicio grupal hay una fila por participante, pero la tarjeta solo
 * aparece en el chat de la modelo con la que se abrio: es decision de producto
 * para no repetirla en cada chat. Un fallo de lectura no se muestra, porque la
 * tarjeta es un extra: el siguiente aviso vuelve a intentarlo.
 */
export default function ValorarServicio({
  empleadaId,
  recarga,
}: {
  empleadaId: string;
  recarga: number;
}) {
  const [servicios, setServicios] = useState<ServicioPorValorar[]>([]);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const respuesta = await pedirConSesion(
          `/api/client-feedback/pending?empleadaId=${encodeURIComponent(empleadaId)}`,
          { cache: "no-store" },
        );
        if (!respuesta.ok) return;
        const lista = (await respuesta.json()) as ServicioPorValorar[];
        if (vigente && Array.isArray(lista)) setServicios(lista);
      } catch {
        // Sin red: se reintenta con el siguiente aviso.
      }
    })();
    return () => {
      vigente = false;
    };
  }, [empleadaId, recarga]);

  if (servicios.length === 0) return null;

  return (
    // Tope de altura: con varios servicios la tarjeta no se come el chat.
    <div className="max-h-[50dvh] space-y-3 overflow-y-auto overscroll-contain">
      {servicios.map((servicio) => (
        <TarjetaDeServicio
          key={servicio.servicioId}
          servicio={servicio}
          empleadaId={empleadaId}
          onCambio={(nuevo) =>
            setServicios((actuales) =>
              actuales.map((s) => (s.servicioId === nuevo.servicioId ? nuevo : s)),
            )
          }
        />
      ))}
    </div>
  );
}
