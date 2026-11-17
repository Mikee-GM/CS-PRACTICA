/**
 * Extractores deterministas de los datos de una reserva.
 *
 * Corren sobre cada mensaje del cliente antes de llamar a la IA, y son los que
 * dejan en el estado de la reserva la duracion, el metodo de pago o si se pide
 * un servicio grupal. No dependen del canal: el mismo texto se interpreta
 * igual llegue por Telegram o por la web.
 */

export type MetodoPagoReserva =
  'efectivo' | 'tarjeta' | 'transferencia' | 'mixto';

/**
 * Horas del servicio a partir de lo que escribio el cliente.
 *
 * Un numero suelto solo cuenta si el mensaje entero es ese numero, que es como
 * se responde a "¿cuantas horas?". Metido en una frase hay que exigir la
 * unidad: antes cualquier cifra entre 1 y 24 se tomaba como la duracion, asi
 * que "carrera 15", "a las 10" o "somos 2" cambiaban en silencio las horas
 * pactadas y el total a cobrar.
 */
export function extractHireDuration(text: string): number | undefined {
  if (/\d+[.,]\d+/.test(text)) {
    return undefined;
  }

  const soloNumero = text.trim().match(/^(\d+)$/);
  if (soloNumero) {
    const hours = parseInt(soloNumero[1], 10);
    if (hours >= 1 && hours <= 24) return hours;
    return undefined;
  }

  // Se recorren todas las cifras con unidad, no solo la primera: en "llego a
  // las 9, quiero 3 horas" la que vale es la segunda.
  for (const match of text.matchAll(
    /\b(\d+)\s*(?:h|hr|hrs|hora|horas|horita|horitas|hra|hras)[a-z]*\b/gi,
  )) {
    const hours = parseInt(match[1], 10);
    if (hours >= 1 && hours <= 24) return hours;
  }

  const normalized = text.toLowerCase().trim();
  const wordDurations: Record<string, number> = {
    una: 1,
    un: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  };
  const word = Object.keys(wordDurations).find(
    (candidate) =>
      normalized === candidate ||
      new RegExp(
        `\\b${candidate}\\s+(?:h|hr|hrs|hora|horas|horita|horitas)\\b`,
      ).test(normalized),
  );
  return word ? wordDurations[word] : undefined;
}

export function extractHirePaymentMethod(
  text: string,
): MetodoPagoReserva | undefined {
  const normalized = text.toLowerCase();
  if (/\bmixto\b/.test(normalized)) return 'mixto';
  if (/\befectivo\b/.test(normalized)) return 'efectivo';
  if (/\btarjeta\b/.test(normalized)) return 'tarjeta';
  if (/\btransferencia\b/.test(normalized)) return 'transferencia';
  return undefined;
}

export function detectGroupServiceIntent(
  text: string,
): 'grupal' | 'incierta' | 'individual' {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const chicas =
    '(chicas?|empleadas?|modelos?|nenas?|amigas?|mujeres|mujer|viejas?)';
  if (
    /\bservicios?\s+grupal(es)?\b/.test(normalized) ||
    /\b(orgia|gangbang|despedida\s+de\s+soltero)\b/.test(normalized) ||
    new RegExp(
      `\\b(grupo\\s+de\\s+${chicas}|mas\\s+de\\s+dos\\s+${chicas}|(tres|cuatro|cinco|3|4|5)\\s+${chicas})\\b`,
    ).test(normalized) ||
    new RegExp(`\\b(tres|cuatro|cinco|3|4|5)\\s+${chicas}\\b`).test(normalized)
  )
    return 'grupal';
  if (
    new RegExp(
      `\\b(varias\\s+${chicas}|otra\\s+${chicas}\\s+mas|dos\\s+${chicas}|un\\s+par\\s+de\\s+${chicas}|mas\\s+${chicas})\\b`,
    ).test(normalized) ||
    /\b(varias\s+a\s+la\s+vez|con\s+una\s+amiga\s+tuya)\b/.test(normalized)
  )
    return 'incierta';
  return 'individual';
}

/** Sustantivos a los que puede referirse "abierto" cuando habla de duracion. */
const DURACION_SUSTANTIVO =
  '(?:servicio|tiempo|duracion|horas?|rato|plan|cita|encuentro)';

/**
 * Detecta que el cliente quiere un servicio de duración abierta / indefinida.
 *
 * "Abierto" solo cuenta junto a un sustantivo de duración. Suelto es la palabra
 * mas ambigua de esta conversacion —"¿el motel esta abierto?", "¿eres
 * abierta?"— y como esto se evalua en cada mensaje, bastaba una de esas para
 * borrar las horas que el cliente ya habia pactado y pasar el servicio a
 * indefinido sin que nadie lo pidiera.
 */
export function detectOpenEndedDuration(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  // Estas no necesitan contexto: no aparecen en esta conversacion hablando de
  // otra cosa.
  if (
    /\b(indefinid[ao]s?|indeterminad[ao]s?|ilimitad[ao]s?)\b/.test(normalized)
  )
    return true;

  if (
    new RegExp(
      `\\b${DURACION_SUSTANTIVO}\\s+(?:\\w+\\s+){0,2}?abiert[ao]s?\\b`,
    ).test(normalized) ||
    new RegExp(`\\babiert[ao]s?\\s+(?:de\\s+)?${DURACION_SUSTANTIVO}\\b`).test(
      normalized,
    )
  )
    return true;

  return /\b(sin\s+(limite|hora\s+de\s+salida|tiempo\s+definido)|el\s+tiempo\s+que\s+sea|hasta\s+que\s+(se\s+acabe|nos\s+cansemos|yo\s+diga|amanezca)|no\s+se\s+cuantas\s+horas|las\s+que\s+salgan)\b/.test(
    normalized,
  );
}

/**
 * Asigna a cada compañera una clave corta (M1, C2…) para nombrarla dentro del
 * prompt. El modelo nunca ve un identificador interno: todo lo que entra en el
 * prompt puede acabar en el chat si alguien consigue sacarla de personaje, y un
 * UUID en pantalla es una fuga que no aporta nada a la conversación.
 */
export function buildModelKeys<T extends { id: string; nombre: string }>(
  models: T[],
  prefix: string,
): { clave: string; model: T }[] {
  return models.map((model, index) => ({
    clave: `${prefix}${index + 1}`,
    model,
  }));
}
