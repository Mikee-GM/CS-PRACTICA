import { kilometrosEntre } from '../common/geo';

/**
 * Decisiones sobre la ubicacion de una reserva que no necesitan ni canal ni
 * base de datos: reciben ya leidas el area de cobertura y las ubicaciones
 * activas, y quien las llama se encarga de obtenerlas (y de su cache).
 */

/** Area atendida: un circulo alrededor del centro de la ciudad. */
export interface AreaDeCobertura {
  ciudad: string;
  centroLat: number;
  centroLng: number;
  radioKm: number;
}

export interface RechazoPorCobertura {
  ciudad: string;
  distanciaKm: number;
}

/**
 * Comprueba si un pin del cliente cae fuera del area que se atiende.
 *
 * Devuelve `null` cuando esta dentro y los datos del rechazo cuando esta
 * fuera. La decision se toma SOLO con las coordenadas: el nombre que el
 * cliente escriba no sirve para esto, porque "Durango" puede ser un estado,
 * una ciudad de otro estado o una calle de aqui al lado.
 */
export function fueraDeCobertura(
  area: AreaDeCobertura,
  lat: number,
  lng: number,
): RechazoPorCobertura | null {
  const distanciaKm = kilometrosEntre(area.centroLat, area.centroLng, lat, lng);
  if (distanciaKm <= area.radioKm) return null;
  return { ciudad: area.ciudad, distanciaKm };
}

/**
 * Busca entre las ubicaciones activas la que nombra la marca `[DATA]`.
 *
 * Coincide en los dos sentidos porque el modelo tanto puede devolver el
 * nombre corto ("Montecarlo" de "Motel Montecarlo") como añadirle palabras.
 */
export function ubicacionPorNombre<T extends { name: string }>(
  activas: readonly T[],
  nombre: unknown,
): T | null {
  if (typeof nombre !== 'string' || !nombre.trim()) return null;
  const buscado = nombre.toLowerCase().trim();
  return (
    activas.find(
      (loc) =>
        loc.name.toLowerCase().includes(buscado) ||
        buscado.includes(loc.name.toLowerCase().trim()),
    ) || null
  );
}

/** Palabras que comparten muchos nombres y no identifican a ninguno. */
export const PALABRAS_GENERICAS_DE_LUGAR: ReadonlySet<string> = new Set([
  'motel',
  'hotel',
  'moteles',
  'suites',
  'suite',
  'villa',
  'villas',
]);

export function normalizarTextoDeLugar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Busca la ubicacion que el propio cliente nombro en la conversacion.
 *
 * Aqui no sirve `ubicacionPorNombre`, que compara un nombre contra otro: lo
 * que se recorre son frases enteras del cliente. Hacen falta dos cosas.
 *
 * Una, quedarse con las palabras que distinguen al motel: en la base estan
 * guardados como "Motel Montecarlo" y el cliente escribe "Montecarlo" a
 * secas, asi que exigir el nombre completo no encontraria nada.
 *
 * Y dos, que esas palabras aparezcan enteras. Sin eso, un motel llamado
 * "Real" se daria por elegido en un "de verdad realmente me interesa".
 *
 * Los textos llegan del mas reciente al mas antiguo: si el cliente cambio de
 * opinion, vale el ultimo que dijo.
 */
export function ubicacionMencionadaEn<T extends { name: string }>(
  activas: readonly T[],
  textos: string[],
): T | null {
  const candidatos = textos.map(normalizarTextoDeLugar).filter(Boolean);
  if (!candidatos.length) return null;

  const contienePalabra = (texto: string, palabra: string): boolean => {
    const escapada = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapada}([^\\p{L}\\p{N}]|$)`,
      'u',
    ).test(texto);
  };

  const conSusPalabras = activas.map((loc) => ({
    loc,
    palabras: normalizarTextoDeLugar(loc.name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (palabra) =>
          palabra.length >= 4 && !PALABRAS_GENERICAS_DE_LUGAR.has(palabra),
      ),
  }));

  for (const texto of candidatos) {
    const encontrada = conSusPalabras.find(
      ({ palabras }) =>
        palabras.length > 0 &&
        palabras.every((palabra) => contienePalabra(texto, palabra)),
    );
    if (encontrada) return encontrada.loc;
  }
  return null;
}
