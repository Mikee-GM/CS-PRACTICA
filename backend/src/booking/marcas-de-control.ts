import {
  detectOpenEndedDuration,
  extractHireDuration,
  extractHirePaymentMethod,
  type MetodoPagoReserva,
} from './extractores-de-reserva';

/**
 * Las marcas que el modelo escribe al final de su respuesta y lo que el
 * backend hace con ellas.
 *
 * Regla de oro: la IA nunca ejecuta nada por si sola. Una marca es una
 * propuesta del modelo, y cada dato que trae se contrasta con lo que el
 * cliente escribio de verdad antes de entrar en la reserva. Si no cuadra, se
 * ignora: el modelo puede equivocarse, alucinar o haber sido convencido por el
 * propio cliente de escribirla.
 */

/** El bloque `[DATA: {...}]` ya leido, sin validar contra el cliente. */
export interface MarcaDeDatos {
  duracion: number | 'indefinida' | null;
  pago: MetodoPagoReserva | null;
  ubicacionPreestablecida: string | null;
  fechaProgramada: string | null;
}

const PATRON_DATOS = /\[DATA:\s*(\{[\s\S]*?\})\]/;
const METODOS: readonly MetodoPagoReserva[] = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'mixto',
];

/**
 * Lee la marca `[DATA]`. Devuelve `null` si no esta o si no es JSON valido;
 * los campos que no tengan la forma esperada quedan en `null` sin invalidar el
 * resto.
 */
export function leerMarcaDeDatos(respuesta: string): MarcaDeDatos | null {
  const coincidencia = respuesta.match(PATRON_DATOS);
  if (!coincidencia) return null;
  let crudo: Record<string, unknown>;
  try {
    const parseado: unknown = JSON.parse(coincidencia[1]);
    if (!parseado || typeof parseado !== 'object') return null;
    crudo = parseado as Record<string, unknown>;
  } catch {
    return null;
  }

  let duracion: MarcaDeDatos['duracion'] = null;
  if (
    typeof crudo.duracion === 'string' &&
    detectOpenEndedDuration(crudo.duracion)
  ) {
    duracion = 'indefinida';
  } else {
    const horas = Number.parseInt(String(crudo.duracion), 10);
    if (Number.isInteger(horas) && horas >= 1 && horas <= 24) duracion = horas;
  }

  const pago =
    typeof crudo.pago === 'string' &&
    (METODOS as readonly string[]).includes(crudo.pago)
      ? (crudo.pago as MetodoPagoReserva)
      : null;

  return {
    duracion,
    pago,
    ubicacionPreestablecida:
      typeof crudo.ubicacionPreestablecida === 'string' &&
      crudo.ubicacionPreestablecida.trim()
        ? crudo.ubicacionPreestablecida.trim()
        : null,
    fechaProgramada:
      typeof crudo.fechaProgramada === 'string' && crudo.fechaProgramada.trim()
        ? crudo.fechaProgramada.trim()
        : null,
  };
}

/** `[GROUP_INTENT]` o `[GROUP_UNCLEAR]`: el modelo cree que pide varias chicas. */
export function marcaDeGrupo(respuesta: string): 'grupal' | 'incierta' | null {
  if (respuesta.includes('[GROUP_INTENT]')) return 'grupal';
  if (respuesta.includes('[GROUP_UNCLEAR]')) return 'incierta';
  return null;
}

const NUMEROS_EN_LETRA: Record<number, string[]> = {
  1: ['una', 'un', 'uno'],
  2: ['dos', 'par'],
  3: ['tres'],
  4: ['cuatro'],
  5: ['cinco'],
  6: ['seis'],
  7: ['siete'],
  8: ['ocho'],
  9: ['nueve'],
  10: ['diez'],
  11: ['once'],
  12: ['doce'],
};

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * La duracion de la marca la dijo el cliente.
 *
 * Cuenta lo que entienden los extractores y, ademas, la cantidad en letra
 * junto a la unidad ("un par de horitas", "tres horas"), que es justo lo que
 * el modelo esta para entender. La palabra sola no basta: "una" aparece en
 * cualquier frase y daria por buena una hora que nadie pidio. Lo que el modelo
 * no puede es inventarse un numero que el cliente no escribio nunca.
 */
export function duracionCorroborada(
  mensajesDelCliente: string[],
  duracion: number | 'indefinida',
): boolean {
  if (duracion === 'indefinida') {
    return mensajesDelCliente.some((m) => detectOpenEndedDuration(m));
  }
  const palabras = NUMEROS_EN_LETRA[duracion] ?? [];
  return mensajesDelCliente.some((mensaje) => {
    if (extractHireDuration(mensaje) === duracion) return true;
    const normalizado = normalizar(mensaje).trim();
    if (palabras.includes(normalizado)) return true;
    return palabras.some((palabra) =>
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${palabra}\\s+(de\\s+)?(h|hr|hrs|hra|hras|hora|horas|horita|horitas)([^\\p{L}\\p{N}]|$)`,
        'u',
      ).test(normalizado),
    );
  });
}

/**
 * El metodo de pago que dijo el cliente, del mensaje mas reciente al mas
 * antiguo. El de la marca no cuenta por si solo: antes bastaba con que
 * el modelo lo escribiera, y asi un "pago" que el cliente nunca eligio podia
 * cerrar la reserva.
 */
export function pagoDichoPorElCliente(
  mensajesDelCliente: string[],
): MetodoPagoReserva | undefined {
  for (let i = mensajesDelCliente.length - 1; i >= 0; i -= 1) {
    const metodo = extractHirePaymentMethod(mensajesDelCliente[i]);
    if (metodo) return metodo;
  }
  return undefined;
}

const HABLA_DE_FECHA: RegExp[] = [
  /\ba las \d{1,2}\b/,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)/,
  /\b(manana|pasado manana|esta noche|en la noche|en la tarde|en la madrugada)\b/,
  /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
  /\b\d{1,2}\/\d{1,2}\b/,
];

/**
 * El cliente hablo de un dia o una hora. Sin eso, una `fechaProgramada` en la
 * marca la habria decidido el modelo, y una cita en el dia equivocado manda a
 * la modelo al motel cuando no hay nadie.
 */
export function clienteHabloDeFechaOHora(
  mensajesDelCliente: string[],
): boolean {
  return mensajesDelCliente.some((mensaje) => {
    const normalizado = normalizar(mensaje);
    return HABLA_DE_FECHA.some((patron) => patron.test(normalizado));
  });
}
