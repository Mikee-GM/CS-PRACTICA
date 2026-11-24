/**
 * Orden de las pestanas del area del cliente, el mismo que la barra inferior.
 * Aparte del componente para poder probar la direccion sin DOM.
 */
export const PESTANAS_DEL_CLIENTE = ["/feed", "/chats", "/cuenta"] as const;

/** Posicion de la pestana a la que pertenece la ruta, o `null` si es otra. */
export function indiceDePestana(ruta: string): number | null {
  const i = PESTANAS_DEL_CLIENTE.findIndex(
    (p) => ruta === p || ruta.startsWith(`${p}/`),
  );
  return i === -1 ? null : i;
}

/**
 * De que lado entra la pantalla: `1` desde la derecha (se avanza en la barra),
 * `-1` desde la izquierda y `0` sin movimiento (primera carga, misma pestana o un
 * origen fuera de la barra).
 */
export function direccionDeLaPestana(
  previa: number | null,
  actual: number | null,
): 1 | -1 | 0 {
  if (previa === null || actual === null || previa === actual) return 0;
  return actual > previa ? 1 : -1;
}
