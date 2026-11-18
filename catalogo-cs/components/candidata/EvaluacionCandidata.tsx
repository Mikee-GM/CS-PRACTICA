"use client";

import { useCallback, useEffect, useState } from "react";

import {
  leerEvaluacion,
  responderEvaluacion,
} from "@/lib/actions/candidata-publica";
import type { PreguntaEvaluacion } from "@/lib/candidata";

type Vista =
  | { tipo: "cargando" }
  | { tipo: "invalido" }
  | { tipo: "error" }
  | { tipo: "completada" }
  | { tipo: "pregunta"; nombre: string; pregunta: PreguntaEvaluacion };

const MIN_TEXTO = 2;
const MAX_TEXTO = 4000;

export default function EvaluacionCandidata({ token }: { token: string }) {
  const [vista, setVista] = useState<Vista>({ tipo: "cargando" });
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const evaluacion = await leerEvaluacion(token);
      if (!evaluacion) {
        setVista({ tipo: "invalido" });
      } else if (!evaluacion.pregunta) {
        setVista({ tipo: "completada" });
      } else {
        setVista({
          tipo: "pregunta",
          nombre: evaluacion.nombre,
          pregunta: evaluacion.pregunta,
        });
      }
    } catch {
      setVista({ tipo: "error" });
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function enviar(
    respuesta: { opcion: number } | { texto: string },
    pregunta: PreguntaEvaluacion,
  ) {
    setEnviando(true);
    setAviso(null);
    try {
      const resultado = await responderEvaluacion(token, {
        preguntaId: pregunta.id,
        ...respuesta,
      });
      if (!resultado) {
        setVista({ tipo: "invalido" });
      } else if ("conflicto" in resultado) {
        // La pregunta pendiente cambio: se relee en vez de adivinar.
        setAviso("Esa pregunta ya estaba respondida. Te mostramos la siguiente.");
        setTexto("");
        await cargar();
      } else if (resultado.completado) {
        setVista({ tipo: "completada" });
      } else {
        setTexto("");
        setVista((actual) =>
          actual.tipo === "pregunta"
            ? { ...actual, pregunta: resultado.pregunta }
            : actual,
        );
      }
    } catch {
      setAviso("No se pudo enviar tu respuesta. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (vista.tipo === "cargando") {
    return (
      <p role="status" className="text-center text-sm text-zinc-400">
        Cargando...
      </p>
    );
  }

  if (vista.tipo === "invalido") {
    return (
      <p role="alert" className="text-center text-sm text-red-400">
        Este enlace no es válido.
      </p>
    );
  }

  if (vista.tipo === "error") {
    return (
      <div className="space-y-4 text-center">
        <p role="alert" className="text-sm text-red-400">
          No se pudo cargar la evaluación.
        </p>
        <button
          type="button"
          onClick={() => {
            setVista({ tipo: "cargando" });
            void cargar();
          }}
          className="text-xs font-medium text-[#C5A55A] underline-offset-4 hover:underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (vista.tipo === "completada") {
    return (
      <p role="status" className="text-center text-sm text-zinc-200">
        Gracias, tus respuestas fueron enviadas.
      </p>
    );
  }

  const { pregunta, nombre } = vista;
  const textoLimpio = texto.trim();
  const textoValido =
    textoLimpio.length >= MIN_TEXTO && textoLimpio.length <= MAX_TEXTO;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-xs text-zinc-500">Hola, {nombre}</p>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#C5A55A]/60">
          Pregunta {pregunta.numero} de {pregunta.total}
        </p>
      </div>

      <h2 className="font-heading text-lg text-white">{pregunta.texto}</h2>

      {pregunta.opciones.length > 0 ? (
        <div className="space-y-3">
          {pregunta.opciones.map((opcion) => (
            <button
              key={opcion.indice}
              type="button"
              disabled={enviando}
              onClick={() => enviar({ opcion: opcion.indice }, pregunta)}
              className="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-[#C5A55A]/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C5A55A] disabled:opacity-50"
            >
              {opcion.texto}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (textoValido) void enviar({ texto: textoLimpio }, pregunta);
          }}
        >
          <label htmlFor="respuesta-candidata" className="sr-only">
            Tu respuesta
          </label>
          <textarea
            id="respuesta-candidata"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={MAX_TEXTO}
            rows={5}
            disabled={enviando}
            className="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C5A55A] disabled:opacity-50"
            placeholder="Escribe tu respuesta"
          />
          <button
            type="submit"
            disabled={enviando || !textoValido}
            className="w-full rounded-xl bg-[#C5A55A] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Enviar respuesta"}
          </button>
        </form>
      )}

      {aviso ? (
        <p role="alert" className="text-center text-xs text-red-400">
          {aviso}
        </p>
      ) : null}
    </div>
  );
}
