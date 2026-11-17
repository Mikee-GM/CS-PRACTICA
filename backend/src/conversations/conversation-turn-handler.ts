import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

/**
 * Punto de extension para responder a un mensaje del cliente.
 *
 * El modulo de conversaciones no conoce a la IA: el paso 6 registra aqui la
 * implementacion que decide si contesta el asistente (y respeta el modo
 * `HUMAN_ACTIVE`). Separarlo asi evita que `ConversationsModule` dependa de
 * `BookingModule` y permite probar la API del chat sin el proveedor de IA.
 */
export const CONVERSATION_TURN_HANDLER = Symbol('CONVERSATION_TURN_HANDLER');

export interface ConversationTurnHandler {
  /**
   * Se llama despues de guardar el mensaje y fuera de la peticion del
   * cliente: lo que tarde o falle aqui no afecta a la respuesta HTTP.
   */
  onClientMessage(conversation: Conversation, message: Message): Promise<void>;
}
