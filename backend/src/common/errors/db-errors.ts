/**
 * Postgres devuelve 23505 cuando un INSERT o UPDATE choca con un indice unico.
 *
 * Se reconoce por `code` y no por el tipo de la clase: TypeORM envuelve el
 * error del driver y, segun por donde llegue, el codigo vive en el propio error
 * o en `driverError`.
 */
export function esViolacionDeUnicidad(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, driverError } = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return code === '23505' || driverError?.code === '23505';
}
