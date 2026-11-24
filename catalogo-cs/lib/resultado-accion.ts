/**
 * Resultado de una Server Action que modifica datos.
 *
 * Next oculta en produccion el texto de cualquier excepcion lanzada desde una
 * Server Action: el usuario veia "An error occurred in the Server Components
 * render" en ingles, sin saber que fallo. Por eso el motivo viaja como valor.
 *
 * Este modulo no importa nada del servidor, para poder usarlo desde los
 * componentes del cliente.
 */
export type ResultadoAccion<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Devuelve el dato si la accion salio bien y, si no, lanza un `Error` normal con
 * el motivo en espanol. Asi los `try/catch` que ya mostraban `error.message`
 * siguen valiendo sin cambios.
 */
export async function desenvolver<T>(
  pendiente: Promise<ResultadoAccion<T>>,
): Promise<T> {
  const resultado = await pendiente;
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.data;
}
