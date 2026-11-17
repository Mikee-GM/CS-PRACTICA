/**
 * Contratos entre el dominio de reserva y los canales por los que habla el
 * cliente.
 *
 * Hoy toda la reserva vive dentro del handler de Telegram y le habla a
 * `ctx` directamente. Para que la web reutilice esa misma logica, el dominio
 * tiene que expresar "dile esto al cliente" o "guarda donde va la reserva" sin
 * saber si detras hay un chat de Telegram o una pagina. Estas interfaces son
 * ese limite; cada canal aporta su implementacion.
 *
 * Solo hay tipos: las implementaciones llegan cuando se mueva el turno de
 * conversacion.
 */

/** Canales por los que un cliente puede conversar con una modelo. */
export type CanalDeReserva = 'telegram' | 'web';

/**
 * A quien y en que conversacion se habla.
 *
 * Identifica por `clienteId` y `empleadaId`, no por chat de Telegram: un
 * cliente web no tiene chat id, y el mismo cliente puede pasar de un canal a
 * otro sin dejar de ser el mismo.
 */
export interface ConversationRef {
  clienteId: string;
  empleadaId: string;
  /** El intento de reserva en curso; `null` mientras solo se conversa. */
  bookingSessionId: string | null;
  channel: CanalDeReserva;
}

/** Un adjunto ya resuelto por el canal: el dominio nunca baja archivos. */
export interface InboundAttachment {
  type: 'receipt' | 'photo' | 'location';
  url?: string;
  lat?: number;
  lng?: number;
}

/** Un mensaje del cliente, ya traducido del formato propio del canal. */
export interface InboundMessage {
  text: string;
  receivedAt: Date;
  attachments: InboundAttachment[];
  /**
   * Identificador del mensaje en su canal. Sirve para descartar reintentos:
   * Telegram reentrega un update si no se confirma a tiempo.
   */
  channelMessageId?: string;
}

/** Quien firma un mensaje saliente, para el historial y para el canal. */
export type RemitenteDeMensaje = 'ia' | 'jefe' | 'sistema';

export interface SendTextOptions {
  sender?: RemitenteDeMensaje;
  /**
   * Pausa antes de enviar. En Telegram simula el tiempo de escribir; el canal
   * decide como representarla, por eso es una sugerencia y no una espera que
   * haga el dominio.
   */
  delayMs?: number;
}

export interface ChatChoice {
  id: string;
  label: string;
}

/**
 * Lo que el dominio de reserva puede pedirle a un canal.
 *
 * Los metodos opcionales son capacidades que no todos los canales tienen igual
 * (botones, pedir ubicacion, fotos). Si faltan, el dominio debe degradar a
 * texto en vez de asumir que existen.
 */
export interface ChatChannel {
  readonly kind: CanalDeReserva;
  sendText(
    ref: ConversationRef,
    text: string,
    opts?: SendTextOptions,
  ): Promise<void>;
  showTyping(ref: ConversationRef): Promise<void>;
  offerChoices?(
    ref: ConversationRef,
    prompt: string,
    choices: ChatChoice[],
  ): Promise<void>;
  requestLocation?(ref: ConversationRef): Promise<void>;
  sendPhoto?(
    ref: ConversationRef,
    url: string,
    caption?: string,
  ): Promise<void>;
}

/**
 * Persistencia del estado de una reserva con control optimista de version.
 *
 * Un cliente puede mandar varios mensajes seguidos y, con varias replicas,
 * cada uno lo puede atender un proceso distinto. Sin version, el segundo en
 * guardar pisa en silencio lo que decidio el primero (la duracion, el metodo
 * de pago...). `save` debe rechazar con `ConflictoDeVersionError` (de
 * `booking.errors`) cuando `expectedVersion` no es la vigente.
 */
export interface BookingStateStore<T> {
  load(ref: ConversationRef): Promise<{ state: T; version: number } | null>;
  save(
    ref: ConversationRef,
    state: T,
    expectedVersion: number,
  ): Promise<{ version: number }>;
}
