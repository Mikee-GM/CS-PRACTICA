"use client";

import { useState, useTransition } from "react";

import {
  empezarCuestionario,
  responderPregunta,
} from "@/lib/actions/reglamento";
import {
  estadoVisible,
  type AvanceDelCuestionario,
  type EstadoVisible,
  type MiReglamento,
  type PreguntaDelCuestionario,
} from "@/lib/reglamento";

type DatosDelCuestionario = NonNullable<MiReglamento["cuestionario"]>;
type Resultado = Extract<AvanceDelCuestionario, { completado: true }>;

/**
 * Una pregunta por pantalla. El servidor lleva el intento: si la persona
 * recarga o cierra, "Continuar" retoma donde iba.
 */
export default function Cuestionario({
  cuestionario,
  puntajeMinimo,
}: {
  cuestionario: DatosDelCuestionario;
  puntajeMinimo: number;
}) {
  const [pregunta, setPregunta] = useState<PreguntaDelCuestionario | null>(
    cuestionario.pregunta,
  );
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function aplicar(avance: AvanceDelCuestionario) {
    if (avance.completado) {
      setPregunta(null);
      setResultado(avance);
    } else {
      setResultado(null);
      setPregunta(avance.pregunta);
    }
  }

  function empezar() {
    setError(null);
    iniciar(async () => {
      const respuesta = await empezarCuestionario();
      if (respuesta.success) aplicar(respuesta.data);
      else setError(respuesta.error);
    });
  }

  function responder(opcionId: string) {
    setError(null);
    iniciar(async () => {
      const respuesta = await responderPregunta(opcionId);
      if (respuesta.success) aplicar(respuesta.data);
      else setError(respuesta.error);
    });
  }

  return (
    <section
      aria-labelledby="titulo-cuestionario"
      className="rounded-2xl border border-[#C5A55A]/30 bg-[#0A0A0A] p-4 sm:p-5"
    >
      <h2
        id="titulo-cuestionario"
        className="font-heading text-2xl font-semibold text-white"
      >
        Cuestionario
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        No bloquea tu trabajo: puedes seguir atendiendo servicios mientras lo
        completas, y puedes intentarlo las veces que haga falta.
      </p>

      <div className="mt-4" aria-live="polite">
        {pregunta ? (
          <Pregunta
            pregunta={pregunta}
            deshabilitado={pendiente}
            onResponder={responder}
          />
        ) : resultado ? (
          <VistaResultado
            resultado={resultado}
            pendiente={pendiente}
            onReintentar={empezar}
          />
        ) : (
          <Portada
            estado={estadoVisible(cuestionario)}
            cuestionario={cuestionario}
            puntajeMinimo={puntajeMinimo}
            pendiente={pendiente}
            onEmpezar={empezar}
          />
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const BOTON_DORADO =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#C5A55A] bg-black px-4 text-sm font-semibold text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black disabled:opacity-50 sm:w-auto";

function Portada({
  estado,
  cuestionario,
  puntajeMinimo,
  pendiente,
  onEmpezar,
}: {
  estado: EstadoVisible;
  cuestionario: DatosDelCuestionario;
  puntajeMinimo: number;
  pendiente: boolean;
  onEmpezar: () => void;
}) {
  const texto =
    estado === "aprobado"
      ? `Aprobaste con un mejor puntaje de ${cuestionario.mejorPuntaje}. Puedes repetirlo cuando quieras.`
      : estado === "reprobado"
        ? `Tu mejor puntaje es ${cuestionario.mejorPuntaje} y el mínimo es ${puntajeMinimo}. Vuelve a leer el reglamento e inténtalo de nuevo.`
        : estado === "en_curso"
          ? "Tienes un intento a medias."
          : `Lee el reglamento y responde para aprobar con ${puntajeMinimo} o más.`;
  const boton =
    estado === "en_curso"
      ? "Continuar"
      : estado === "sin_empezar"
        ? "Empezar cuestionario"
        : "Intentar de nuevo";

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-300">{texto}</p>
      <button
        type="button"
        onClick={onEmpezar}
        disabled={pendiente}
        className={BOTON_DORADO}
      >
        {pendiente ? "Cargando..." : boton}
      </button>
    </div>
  );
}

function Pregunta({
  pregunta,
  deshabilitado,
  onResponder,
}: {
  pregunta: PreguntaDelCuestionario;
  deshabilitado: boolean;
  onResponder: (opcionId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#C5A55A]">
        Pregunta {pregunta.numero} de {pregunta.total}
      </p>
      <p className="text-base text-white">{pregunta.texto}</p>
      <div className="space-y-2">
        {pregunta.opciones.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            disabled={deshabilitado}
            onClick={() => onResponder(opcion.id)}
            className="min-h-11 w-full rounded-xl border border-zinc-700 bg-[#050505] px-4 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:border-[#C5A55A] disabled:opacity-50"
          >
            {opcion.texto}
          </button>
        ))}
      </div>
    </div>
  );
}

function VistaResultado({
  resultado,
  pendiente,
  onReintentar,
}: {
  resultado: Resultado;
  pendiente: boolean;
  onReintentar: () => void;
}) {
  return (
    <div className="space-y-3">
      <p
        className={
          resultado.aprobado
            ? "font-heading text-2xl font-semibold text-[#E8D5A3]"
            : "font-heading text-2xl font-semibold text-zinc-200"
        }
      >
        {resultado.aprobado ? "Aprobado" : "No aprobado"}
      </p>
      <p className="text-sm text-zinc-300">
        Puntaje: {resultado.puntaje} ({resultado.correctas} de {resultado.total}{" "}
        correctas). Mínimo para aprobar: {resultado.puntajeMinimo}. Mejor
        puntaje: {resultado.mejorPuntaje}.
      </p>
      {!resultado.aprobado ? (
        <button
          type="button"
          onClick={onReintentar}
          disabled={pendiente}
          className={BOTON_DORADO}
        >
          {pendiente ? "Cargando..." : "Intentar de nuevo"}
        </button>
      ) : null}
    </div>
  );
}
