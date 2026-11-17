/**
 * Cuando la ubicacion de un chofer sirve para el reparto, en un solo sitio.
 *
 * El reparto ordena por cercania, y una posicion de hace horas pone primero a
 * quien ya no esta ahi: el viaje se le ofrece al que "esta a dos cuadras" y en
 * realidad cruzo la ciudad. Con la plataforma como unico canal, el portal manda
 * la posicion sola mientras esta abierto (como mucho una escritura por minuto
 * con el telefono quieto), asi que quince minutos sin noticias ya no es un
 * telefono parado: es un portal cerrado o sin permiso de ubicacion.
 *
 * Vive aparte, como `turno-vigente.ts`, porque la misma condicion la aplican el
 * reparto, el diagnostico de "no hay choferes" y la ficha que ve el jefe; con
 * tres copias, alguna acabaria diciendo que un chofer entra cuando no entra.
 */

/** Minutos que puede tener la ultima posicion antes de dejar de contar. */
export const MINUTOS_DE_UBICACION_FRESCA = 15;

/**
 * El SQL que decide si la posicion guardada de un chofer es reciente.
 *
 * Se compara contra `now()` de PostgreSQL y no contra el reloj del backend:
 * la marca la escribe la base y la consulta corre en la base, asi que un
 * desfase entre maquinas no mueve el corte.
 *
 * Una marca nula cuenta como vieja. Es la posicion que alguien tecleo a mano
 * en el alta o en la edicion del chofer, y esa no dice donde esta ahora.
 *
 * `alias` es el de la tabla `choferes` en la consulta que lo use. No lleva
 * parametros, asi que sirve igual para el query builder y para la consulta
 * suelta.
 */
export function sqlUbicacionFresca(alias: string): string {
  return `(${alias}.ultima_ubicacion_at IS NOT NULL
    AND ${alias}.ultima_ubicacion_at >= now() - interval '${MINUTOS_DE_UBICACION_FRESCA} minutes')`;
}
