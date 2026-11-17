/**
 * Errores tipados del dominio de reserva.
 *
 * Son clases propias, y no excepciones HTTP de Nest, porque el dominio de
 * reserva lo usan tanto un controller web como un handler de Telegram: cada
 * canal decide como traducirlos (un 429, un mensaje en personaje...) sin que
 * el dominio sepa por donde llego el cliente.
 */

/**
 * El cliente agoto las llamadas de IA del dia (`MAX_DAILY_AI_CALLS`).
 *
 * Se lanza antes de llamar al proveedor y sin sumar la llamada, para que el
 * rechazo no consuma cupo ni cueste dinero.
 */
export class LimiteDiarioDeIaError extends Error {
  constructor(
    readonly clienteId: string,
    readonly limite: number,
  ) {
    super(
      `El cliente ${clienteId} alcanzo el limite diario de ${limite} llamadas de IA.`,
    );
    this.name = 'LimiteDiarioDeIaError';
  }
}

/**
 * Se intento guardar el estado de una reserva sobre una version que ya no es
 * la vigente: otro mensaje del mismo cliente lo guardo antes.
 *
 * Quien lo recibe debe recargar y reintentar; pisar el estado ajeno es
 * justamente lo que el control de version existe para impedir.
 */
export class ConflictoDeVersionError extends Error {
  constructor(
    readonly versionEsperada: number,
    readonly versionActual: number | null,
  ) {
    super(
      `El estado de la reserva cambio: se esperaba la version ${versionEsperada} y la vigente es ${versionActual ?? 'ninguna'}.`,
    );
    this.name = 'ConflictoDeVersionError';
  }
}
