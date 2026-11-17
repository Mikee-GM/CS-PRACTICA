/**
 * Nombres de los eventos en vivo del chat web.
 *
 * Viajan por los canales SSE con la forma `{ type, data }` que usan los demas
 * eventos del backend, y solo llevan ids: el navegador vuelve a pedir lo que
 * cambio por la API, que es la que aplica los permisos. Asi un evento que
 * llegara a quien no debe no filtraria el contenido de ningun mensaje.
 *
 * Viven en un archivo propio para que el frontend y los pasos siguientes
 * (turno de la IA, comprobantes, toma de control del jefe) usen los mismos
 * nombres.
 */
export const MESSAGE_CREATED = 'message_created';
export const CONVERSATION_MODE_CHANGED = 'conversation_mode_changed';
export const RECEIPT_STATUS = 'receipt_status';
export const TYPING = 'typing';

export type ConversationEventType =
  | typeof MESSAGE_CREATED
  | typeof CONVERSATION_MODE_CHANGED
  | typeof RECEIPT_STATUS
  | typeof TYPING;

export type MessageCreatedEvent = {
  type: typeof MESSAGE_CREATED;
  data: { conversationId: string; messageId: string };
};
