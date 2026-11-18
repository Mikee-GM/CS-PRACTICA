/**
 * Evaluacion publica de candidatas: forma del token y del enlace. Vive aparte
 * de la server action porque la pagina, el panel y las pruebas la comparten.
 */

/** Token aleatorio base64url del backend; cualquier otra forma es un 404 seguro. */
export const TOKEN_CANDIDATA = /^[A-Za-z0-9_-]{8,64}$/;

export function enlaceDeEvaluacion(origen: string, token: string) {
  return `${origen}/candidata/${encodeURIComponent(token)}`;
}

export type OpcionEvaluacion = { indice: number; texto: string };

export type PreguntaEvaluacion = {
  id: string;
  texto: string;
  numero: number;
  total: number;
  /** Vacia: la respuesta es escrita. */
  opciones: OpcionEvaluacion[];
};

export type EvaluacionPublica = {
  nombre: string;
  estado: string;
  /** Null con la evaluacion completada. */
  pregunta: PreguntaEvaluacion | null;
};

export type RespuestaEvaluacion =
  | { preguntaId: string; opcion: number }
  | { preguntaId: string; texto: string };

export type ResultadoRespuesta =
  | { completado: true }
  | { completado: false; pregunta: PreguntaEvaluacion }
  | { conflicto: true }
  | null;
