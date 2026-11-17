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
// La conversacion cambio de estado (por ejemplo, la IA la paso a revision).
export const CONVERSATION_STATUS_CHANGED = 'conversation_status_changed';

export type ConversationEventType =
  | typeof MESSAGE_CREATED
  | typeof CONVERSATION_MODE_CHANGED
  | typeof RECEIPT_STATUS
  | typeof TYPING
  | typeof CONVERSATION_STATUS_CHANGED;

export type MessageCreatedEvent = {
  type: typeof MESSAGE_CREATED;
  data: { conversationId: string; messageId: string };
};

export type TypingEvent = {
  type: typeof TYPING;
  data: { conversationId: string };
};

/**
 * Como quedo el analisis de un comprobante. Ninguno confirma el dinero: eso
 * solo lo hace el equipo al comprobar el CEP.
 * - `recibido`: la foto cuadra; falta que el equipo confirme la transferencia.
 * - `en_revision`: la foto no se pudo leer con certeza; la revisa una persona.
 * - `rechazado`: no vale (no es un comprobante, monto o cuenta incorrectos,
 *   clave de rastreo ya usada); el cliente tiene que mandar otro.
 * - `error`: el analisis fallo; puede volver a mandarlo.
 */
export type EstadoDelComprobante =
  'recibido' | 'en_revision' | 'rechazado' | 'error';

export type ReceiptStatusEvent = {
  type: typeof RECEIPT_STATUS;
  data: {
    conversationId: string;
    messageId: string;
    status: EstadoDelComprobante;
  };
};

export type ConversationStatusChangedEvent = {
  type: typeof CONVERSATION_STATUS_CHANGED;
  data: { conversationId: string; status: string };
};
