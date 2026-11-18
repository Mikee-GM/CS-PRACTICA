/**
 * Tipos y reglas de presentacion del reglamento del personal.
 *
 * Copia de la forma que devuelve `ReglamentoWebService` en el backend
 * (`staff-onboarding/me`); las fechas llegan como texto ISO por el JSON.
 */

export type PreguntaDelCuestionario = {
  id: string;
  texto: string;
  /** Posicion dentro del intento, empezando en 1. */
  numero: number;
  total: number;
  opciones: { id: string; texto: string }[];
};

export type EstadoDelCuestionario = "pending" | "in_progress" | "completed";

export type MiReglamento = {
  reglamento: {
    titulo: string;
    contenido: string;
    publicadoEn: string;
    puntajeMinimo: number;
  } | null;
  cuestionario: {
    estado: EstadoDelCuestionario;
    esRenovacion: boolean;
    intentos: number;
    mejorPuntaje: number;
    aprobadoEn: string | null;
    pregunta: PreguntaDelCuestionario | null;
  } | null;
};

export type AvanceDelCuestionario =
  | { completado: false; pregunta: PreguntaDelCuestionario }
  | {
      completado: true;
      aprobado: boolean;
      puntaje: number;
      mejorPuntaje: number;
      puntajeMinimo: number;
      correctas: number;
      total: number;
      intentos: number;
    };

export type EstadoVisible =
  | "aprobado"
  | "reprobado"
  | "en_curso"
  | "sin_empezar";

/**
 * Lo que la persona ve del estado. El backend no tiene un estado "reprobado":
 * es `pending` con intentos ya gastados, y se distingue de no haber empezado
 * por el contador.
 */
export function estadoVisible(
  cuestionario: MiReglamento["cuestionario"],
): EstadoVisible {
  if (!cuestionario) return "sin_empezar";
  if (cuestionario.estado === "completed") return "aprobado";
  if (cuestionario.estado === "in_progress") return "en_curso";
  return cuestionario.intentos > 0 ? "reprobado" : "sin_empezar";
}

export const TEXTO_DE_ESTADO: Record<EstadoVisible, string> = {
  aprobado: "Aprobado",
  reprobado: "No aprobado",
  en_curso: "En curso",
  sin_empezar: "Pendiente",
};
