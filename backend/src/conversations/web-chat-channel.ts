import { Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  capClientMessage,
  quitarEmojis,
  stripControlMarkers,
} from '../ai/ai-guardrails';
import type { HistorialDeReserva } from '../booking/booking-ai.service';
import type {
  AvisoAlEquipo,
  ChatChannel,
  ConversationRef,
  SendTextOptions,
} from '../booking/chat-channel';
import { describeError } from '../common/errors/error-message';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import {
  CONVERSATION_STATUS_CHANGED,
  ConversationStatusChangedEvent,
  MESSAGE_CREATED,
  MessageCreatedEvent,
  TYPING,
  TypingEvent,
} from './conversation-events';
import { Conversation } from './entities/conversation.entity';
import {
  Message,
  MessageAttachment,
  MessageSender,
} from './entities/message.entity';

/** Lo que el modelo lee cuando el cliente solo mando su ubicacion. */
const TEXTO_DE_UBICACION = 'Te compartí mi ubicación.';

export interface OpcionesDelCanalWeb {
  /**
   * Primer mensaje del cliente que atiende este turno. El historial se corta
   * antes de el: esos mensajes ya le llegan al modelo como mensaje actual.
   */
  antesDeMensajeId?: string | null;
  /** Tope de la pausa de "escribiendo"; 0 la desactiva (pruebas). */
  pausaMaximaMs: number;
}

type FilaDeHistorial = {
  sender: MessageSender;
  body: string;
  attachment: MessageAttachment | null;
};

/**
 * El chat web visto desde el dominio de reserva.
 *
 * Cada salida es un `Message` de la conversacion: se guarda bajo el mismo
 * protocolo que el mensaje del cliente (fila de la conversacion bloqueada
 * mientras se inserta) y se anuncia por SSE solo con ids, al cliente y a los
 * jefes de la modelo. Se crea uno por turno porque el historial depende de que
 * mensajes atiende ese turno.
 */
export class WebChatChannel implements ChatChannel {
  readonly kind = 'web' as const;
  private readonly logger = new Logger(WebChatChannel.name);
  private jefes: Array<string | null | undefined> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly empleadasRepository: Repository<Empleadas>,
    private readonly realtime: RealtimeEventsService,
    private readonly opciones: OpcionesDelCanalWeb,
  ) {}

  async sendText(
    ref: ConversationRef,
    text: string,
    opts: SendTextOptions = {},
  ): Promise<void> {
    const conversationId = conversacionDe(ref);
    // Ultima barrera: en la web no sale ningun emoji, lo escriba quien lo
    // escriba. Un texto que se quede vacio no se manda.
    const cuerpo = quitarEmojis(text).trim();
    if (!cuerpo) {
      this.logger.warn(
        `Se descarta un mensaje vacio hacia la conversacion ${conversationId}.`,
      );
      return;
    }

    const pausa = Math.min(
      Math.max(opts.delayMs ?? 0, 0),
      this.opciones.pausaMaximaMs,
    );
    if (pausa > 0) await esperar(pausa);

    const sender: MessageSender = opts.sender ?? 'ia';
    const message = await this.dataSource.transaction(async (manager) => {
      const conversation = await manager.findOne(Conversation, {
        where: { id: conversationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation) return null;
      const guardado = await manager.save(
        manager.create(Message, { conversationId, sender, body: cuerpo }),
      );
      await manager.update(
        Conversation,
        { id: conversationId },
        { lastMessageAt: guardado.createdAt },
      );
      return guardado;
    });
    if (!message) return;

    const evento: MessageCreatedEvent = {
      type: MESSAGE_CREATED,
      data: { conversationId, messageId: message.id },
    };
    await this.anunciar(ref, evento);
  }

  showTyping(ref: ConversationRef): Promise<void> {
    const evento: TypingEvent = {
      type: TYPING,
      data: { conversationId: conversacionDe(ref) },
    };
    this.realtime.emitToClient(ref.clienteId, evento);
    return Promise.resolve();
  }

  /**
   * Los ultimos mensajes antes del turno, del mas antiguo al mas reciente. Los
   * del `sistema` no entran: son avisos de la plataforma, no algo que la modelo
   * haya dicho. Los del jefe cuentan como de la modelo, porque es la voz que el
   * cliente tiene delante.
   */
  async historialReciente(
    ref: ConversationRef,
    limite: number,
  ): Promise<HistorialDeReserva> {
    const filas: FilaDeHistorial[] = await this.dataSource.query(
      `SELECT m.sender, m.body, m.attachment
       FROM messages m
       WHERE m.conversation_id = $1
         AND m.sender <> 'sistema'
         AND ($2::uuid IS NULL OR (m.created_at, m.id) < (
               SELECT c.created_at, c.id FROM messages c
               WHERE c.id = $2::uuid AND c.conversation_id = $1))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      [conversacionDe(ref), this.opciones.antesDeMensajeId ?? null, limite],
    );

    const historial: HistorialDeReserva = [];
    for (const fila of filas.reverse()) {
      if (fila.sender === 'cliente') {
        // Lo del cliente nunca llega crudo al modelo: sin marcas de control y
        // recortado, igual que el mensaje del turno.
        const texto =
          capClientMessage(stripControlMarkers(fila.body ?? '')) ||
          (fila.attachment?.type === 'ubicacion' ? TEXTO_DE_UBICACION : '');
        if (texto) historial.push({ role: 'user', parts: [{ text: texto }] });
      } else if (fila.body?.trim()) {
        historial.push({ role: 'model', parts: [{ text: fila.body }] });
      }
    }
    return historial;
  }

  /**
   * Pone la conversacion en revision (si estaba activa), le engancha el
   * borrador si lo hay y lo anuncia. El aviso al jefe es ese cambio de estado
   * mas el mensaje del sistema, que su panel ya recibe como cualquier otro.
   */
  async notificarAlEquipo(
    ref: ConversationRef,
    aviso: AvisoAlEquipo,
  ): Promise<void> {
    const conversationId = conversacionDe(ref);
    this.logger.warn(
      `Conversacion ${conversationId} puesta delante del equipo (${aviso.motivo}): ${aviso.detalle}`,
    );
    const filas: Array<{ status: string }> = await this.dataSource.query(
      `WITH actualizada AS (
         UPDATE conversations
            SET status = CASE WHEN status = 'activa'
                              THEN 'en_revision'::conversations_status_enum
                              ELSE status END,
                booking_session_id = COALESCE($2::uuid, booking_session_id),
                updated_at = now()
          WHERE id = $1
         RETURNING status
       )
       SELECT status FROM actualizada`,
      [conversationId, aviso.bookingSessionId ?? null],
    );

    if (filas[0]) {
      const evento: ConversationStatusChangedEvent = {
        type: CONVERSATION_STATUS_CHANGED,
        data: { conversationId, status: filas[0].status },
      };
      await this.anunciar(ref, evento);
    }
    if (aviso.mensajeAlCliente) {
      await this.sendText(ref, aviso.mensajeAlCliente, { sender: 'sistema' });
    }
  }

  /**
   * Al cliente y a los jefes de la modelo; sin jefe asignado `emitToBosses`
   * lo reparte a todos. El mensaje ya esta guardado: si el aviso falla se
   * registra y el panel lo vera al refrescar.
   */
  private async anunciar(
    ref: ConversationRef,
    evento: { type: string; data: object },
  ): Promise<void> {
    try {
      this.realtime.emitToClient(ref.clienteId, evento);
      this.realtime.emitToBosses(await this.jefesDeLaModelo(ref), evento);
    } catch (error) {
      this.logger.warn(
        `No se pudo anunciar ${evento.type} de la conversacion ${ref.conversationId}: ${describeError(error)}`,
      );
    }
  }

  private async jefesDeLaModelo(
    ref: ConversationRef,
  ): Promise<Array<string | null | undefined>> {
    if (!this.jefes) {
      const empleada = await this.empleadasRepository.findOne({
        where: { id: ref.empleadaId },
        select: { id: true, jefeId: true, jefeSecundarioId: true },
      });
      this.jefes = [empleada?.jefeId, empleada?.jefeSecundarioId];
    }
    return this.jefes;
  }
}

function conversacionDe(ref: ConversationRef): string {
  if (!ref.conversationId) {
    throw new Error('El canal web necesita el id de la conversacion.');
  }
  return ref.conversationId;
}

export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
