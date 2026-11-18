import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { describeError } from '../common/errors/error-message';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { MESSAGE_CREATED, MessageCreatedEvent } from './conversation-events';
import { Conversation } from './entities/conversation.entity';
import { Message, type MessageSender } from './entities/message.entity';

export type AvisoAlCliente = {
  clienteId: string;
  serviceId?: string | null;
  employeeId?: string | null;
  /** Texto final, ya sin emojis ni formato de Telegram: se guarda tal cual. */
  texto: string;
};

/**
 * Deja en el chat web del cliente los avisos del ciclo de vida del servicio
 * (aceptado, rechazado, en camino...), que hasta ahora solo salian por
 * Telegram y no llegaban a quien reservo desde la web.
 *
 * No depende de `services/` a proposito: `ServicesModule` lo importa, y si el
 * notificador conociera al servicio se cerraria un ciclo entre modulos. Por eso
 * recibe ids y el texto ya redactado, y la relacion servicio-borrador la
 * resuelve la base.
 *
 * Nunca lanza. El aviso es accesorio respecto a la operacion que lo origina:
 * el servicio ya se acepto o se cancelo, y un fallo aqui no puede deshacerlo.
 */
@Injectable()
export class ConversationNotifier {
  private readonly logger = new Logger(ConversationNotifier.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /**
   * Guarda el aviso como mensaje del `sistema` y lo anuncia por SSE.
   *
   * Devuelve `true` si quedo entregado y `false` si el cliente no tiene
   * conversacion web a la que mandarlo o si algo fallo.
   */
  async notifyClient(aviso: AvisoAlCliente): Promise<boolean> {
    const texto = aviso.texto.trim();
    if (!texto) return false;

    let entregado: { conversation: Conversation; message: Message } | null;
    try {
      const conversationId = await this.resolverConversacion(aviso);
      if (!conversationId) return false;
      entregado = await this.guardar(conversationId, aviso.clienteId, texto);
    } catch (error) {
      this.logger.error(
        `No se pudo dejar el aviso en el chat web del cliente ${aviso.clienteId} (servicio ${aviso.serviceId ?? 'sin servicio'}): ${describeError(error)}`,
      );
      return false;
    }
    if (!entregado) return false;

    await this.anunciar(
      aviso.clienteId,
      entregado.conversation,
      entregado.message,
    );
    return true;
  }

  /**
   * Escribe en una conversacion concreta y lo anuncia por SSE.
   *
   * A diferencia de `notifyClient`, si lanza: lo usa quien actua a peticion
   * de una persona (un jefe que escribe desde la solicitud grupal) y necesita
   * saber que el mensaje no se guardo. 404 si la conversacion no existe y 409
   * si esta cerrada. El texto llega ya limpio; aqui no se filtra.
   */
  async escribir(entrada: {
    conversationId: string;
    sender: Extract<MessageSender, 'jefe' | 'sistema'>;
    texto: string;
  }): Promise<Message> {
    const texto = entrada.texto.trim();
    if (!texto)
      throw new BadRequestException('El mensaje no puede estar vacío');
    const entregado = await this.guardar(
      entrada.conversationId,
      null,
      texto,
      entrada.sender,
    );
    if (!entregado) throw new NotFoundException('Conversación no encontrada');
    await this.anunciar(
      entregado.conversation.clientId,
      entregado.conversation,
      entregado.message,
    );
    return entregado.message;
  }

  /**
   * Primero la conversacion del propio servicio, por `service_id` o por el
   * borrador del que salio (`booking_session_id`); entre las dos gana la que
   * ya apunta al servicio. Esa vale aunque este cerrada: el aviso pertenece a
   * su historial, por ejemplo la cancelacion que la cerro.
   *
   * Si el servicio no tiene conversacion propia (lo dio de alta un jefe a
   * mano, por ejemplo), la abierta con esa modelo: es donde el cliente esta
   * hablando de ella. Una cerrada con la modelo no sirve, porque seria un chat
   * de otra reserva ya terminada.
   */
  private async resolverConversacion(
    aviso: AvisoAlCliente,
  ): Promise<string | null> {
    if (aviso.serviceId) {
      const filas: Array<{ id: string }> = await this.dataSource.query(
        `SELECT c.id
         FROM conversations c
         WHERE c.client_id = $1
           AND (c.service_id = $2
                OR c.booking_session_id = (
                  SELECT s.booking_session_id FROM servicios s WHERE s.id = $2))
         ORDER BY (c.service_id IS NOT DISTINCT FROM $2) DESC,
                  c.last_message_at DESC NULLS LAST,
                  c.created_at DESC
         LIMIT 1`,
        [aviso.clienteId, aviso.serviceId],
      );
      if (filas[0]) return filas[0].id;
    }

    if (aviso.employeeId) {
      const filas: Array<{ id: string }> = await this.dataSource.query(
        `SELECT c.id
         FROM conversations c
         WHERE c.client_id = $1
           AND c.employee_id = $2
           AND c.status <> 'cerrada'
         ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
         LIMIT 1`,
        [aviso.clienteId, aviso.employeeId],
      );
      if (filas[0]) return filas[0].id;
    }

    return null;
  }

  /**
   * Mismo protocolo que el mensaje del cliente en `ConversationsService`: la
   * fila de la conversacion se bloquea mientras se inserta, para que
   * `last_message_at` no retroceda si un mensaje del cliente se confirma a la
   * vez que este aviso.
   */
  private guardar(
    conversationId: string,
    clienteId: string | null,
    texto: string,
    sender: Extract<MessageSender, 'jefe' | 'sistema'> = 'sistema',
  ): Promise<{ conversation: Conversation; message: Message } | null> {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await manager.findOne(Conversation, {
        where: clienteId
          ? { id: conversationId, clientId: clienteId }
          : { id: conversationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation) return null;
      // Un aviso del ciclo de vida si cabe en una cerrada (es su historial);
      // un mensaje de una persona no: el cliente ya no puede contestar ahi.
      if (sender === 'jefe' && conversation.status === 'cerrada') {
        throw new ConflictException(
          'Esta conversación está cerrada; el cliente ya no la ve como abierta',
        );
      }

      const message = await manager.save(
        manager.create(Message, {
          conversationId,
          sender,
          body: texto,
        }),
      );
      await manager.update(
        Conversation,
        { id: conversationId },
        { lastMessageAt: message.createdAt },
      );
      conversation.lastMessageAt = message.createdAt;
      return { conversation, message };
    });
  }

  /**
   * El mismo evento minimo que emite `ConversationsService` con cada mensaje:
   * al cliente y a los jefes de la modelo, que siguen el chat desde su panel.
   * El mensaje ya esta guardado; si el evento falla lo vera al refrescar.
   */
  private async anunciar(
    clienteId: string,
    conversation: Conversation,
    message: Message,
  ): Promise<void> {
    const evento: MessageCreatedEvent = {
      type: MESSAGE_CREATED,
      data: { conversationId: conversation.id, messageId: message.id },
    };
    try {
      this.realtime.emitToClient(clienteId, evento);
      const empleada = await this.empleadasRepository.findOne({
        where: { id: conversation.employeeId },
        select: { id: true, jefeId: true, jefeSecundarioId: true },
      });
      this.realtime.emitToBosses(
        [empleada?.jefeId, empleada?.jefeSecundarioId],
        evento,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar del mensaje ${message.id} de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }
}
