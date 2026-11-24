/**
 * Contratos entre el dominio de reserva y los canales por los que habla el
 * cliente.
 *
 * El dominio expresa "dile esto al cliente" o "guarda donde va la reserva" sin
 * saber como se entrega ni donde se guarda. Estas interfaces son ese limite;
 * el canal aporta su implementacion.
 *
 * Solo hay tipos: cada canal aporta su implementacion (la web, en
 * `conversations/web-chat-channel.ts`).
 */

import type { HistorialDeReserva } from './booking-ai.service';

/** Canales por los que un cliente puede conversar con una modelo. */
export type CanalDeReserva = 'web';

/**
 * A quien y en que conversacion se habla.
 *
 * Identifica por `clienteId` y `empleadaId`: un cliente web no tiene chat id.
 */
export interface ConversationRef {
  clienteId: string;
  empleadaId: string;
  /** El intento de reserva en curso; `null` mientras solo se conversa. */
  bookingSessionId: string | null;
  channel: CanalDeReserva;
  /**
   * La conversacion web concreta: con ella el estado y los mensajes se
   * localizan sin depender de que solo haya una conversacion abierta por
   * pareja.
   */
  conversationId?: string;
}

/** Un adjunto ya resuelto por el canal: el dominio nunca baja archivos. */
export interface InboundAttachment {
  type: 'receipt' | 'photo' | 'location';
  url?: string;
  lat?: number;
  lng?: number;
  /** Direccion escrita que acompaña a un pin, si el canal la tiene. */
  address?: string;
}

/** Un mensaje del cliente, ya traducido del formato propio del canal. */
export interface InboundMessage {
  text: string;
  receivedAt: Date;
  attachments: InboundAttachment[];
  /**
   * Identificador del mensaje en su canal. Sirve para descartar reintentos si
   * el canal reentrega un mensaje que no llego a confirmarse.
   */
  channelMessageId?: string;
}

/** Quien firma un mensaje saliente, para el historial y para el canal. */
export type RemitenteDeMensaje = 'ia' | 'jefe' | 'sistema';

export interface SendTextOptions {
  sender?: RemitenteDeMensaje;
  /**
   * Pausa antes de enviar. Simula el tiempo de escribir; el canal
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
  /**
   * Mensajes anteriores al turno en curso, en el formato del modelo. Un canal
   * que ya guarda la conversacion (la web) la entrega de ahi; sin este metodo
   * el turno solo ve el mensaje actual.
   */
  historialReciente?(
    ref: ConversationRef,
    limite: number,
  ): Promise<HistorialDeReserva>;
  /**
   * Pone la conversacion delante del equipo (el jefe de la modelo): una
   * reserva lista para revisar, una peticion de hablar con una persona, un
   * fallo de la IA. `mensajeAlCliente`, si viene, se le deja como mensaje del
   * sistema.
   */
  notificarAlEquipo?(ref: ConversationRef, aviso: AvisoAlEquipo): Promise<void>;
}

export type MotivoDeAvisoAlEquipo =
  | 'reserva_lista'
  | 'peticion_humana'
  | 'servicio_grupal'
  | 'fallo_ia'
  | 'conversacion_atascada'
  | 'peticion_prohibida'
  | 'cancelacion_solicitada'
  | 'comprobante_recibido'
  | 'media_del_cliente';

export interface AvisoAlEquipo {
  motivo: MotivoDeAvisoAlEquipo;
  /** Para el registro: por que se le pasa, en una frase. */
  detalle: string;
  /** Borrador de reserva que el jefe tiene que revisar, si lo hay. */
  bookingSessionId?: string | null;
  mensajeAlCliente?: string;
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
