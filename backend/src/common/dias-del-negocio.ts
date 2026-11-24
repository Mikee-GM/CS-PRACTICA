import { desdeHoraDelNegocio } from './locale';

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Una fecha `AAAA-MM-DD` es un dia del calendario del negocio, no medianoche UTC.
 *
 * `new Date('2026-11-23')` es el 23 a las 00:00 UTC, es decir el domingo 22 a las
 * 18:00 en Mexico: el Centro de Mando mandaba fechas planas y su corte semanal
 * perdia desde el sabado por la tarde y no encontraba los cortes confirmados
 * (0 de 3 aunque hubiera 3). Un instante completo (`...T06:00:00.000Z`) se respeta
 * tal cual.
 */
export function inicioDelDia(valor: unknown): Date {
  const texto = String(valor);
  if (SOLO_FECHA.test(texto)) {
    return desdeHoraDelNegocio(`${texto}T00:00:00`) ?? new Date(NaN);
  }
  return new Date(texto);
}

/** El ultimo milisegundo de ese dia del calendario del negocio. */
export function finDelDia(valor: unknown): Date {
  const texto = String(valor);
  if (SOLO_FECHA.test(texto)) {
    const fin = desdeHoraDelNegocio(`${texto}T23:59:59`);
    return fin ? new Date(fin.getTime() + 999) : new Date(NaN);
  }
  return new Date(texto);
}
