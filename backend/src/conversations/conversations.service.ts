import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { Clientes } from '../clients/entities/client.entity';
import { describeError } from '../common/errors/error-message';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { MESSAGE_CREATED, MessageCreatedEvent } from './conversation-events';
import {
  CONVERSATION_TURN_HANDLER,
  ConversationTurnHandler,
} from './conversation-turn-handler';
import {
  ListMessagesDto,
  DEFAULT_MESSAGES_PAGE,
} from './dto/list-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  Conversation,
  ConversationStatus,
} from './entities/conversation.entity';
import {
  Message,
  MessageAttachment,
  MessageSender,
} from './entities/message.entity';

/** Tope de la bandeja: un cliente con mas chats abiertos que esto es anomalo. */
export const MAX_CONVERSATIONS_LISTED = 100;

/** Caracteres del ultimo mensaje que se muestran en la bandeja. */
export const PREVIEW_LENGTH = 140;

const UQ_OPEN_CONVERSATION = 'uq_conversations_client_employee_open';

/**
 * Lo que el cliente ve de la modelo. Son los mismos datos que ya publica el
 * catalogo (`GET /catalog/employees`); nunca el nombre real ni el contacto.
 */
export type ModeloDelChat = {
  id: string;
  nombreArtistico: string;
  slugCatalogo: string;
  fotoPerfilUrl: string | null;
};

export type ResumenDeConversacion = {
  id: string;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  employee: ModeloDelChat;
  lastMessage: {
    id: string;
    sender: MessageSender;
    preview: string;
    hasAttachment: boolean;
    createdAt: Date;
  } | null;
};

export type MensajeDelChat = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string;
  // Solo el tipo: la clave del archivo en R2 no se entrega hasta que el paso
  // de comprobantes decida como se sirven (URL firmada o proxy).
  attachment: { type: MessageAttachment['type'] } | null;
  clientMessageId: string | null;
  createdAt: Date;
};

export type PaginaDeMensajes = {
  items: MensajeDelChat[];
  nextCursor: string | null;
};

type FilaResumen = {
  id: string;
  status: ConversationStatus;
  last_message_at: Date | null;
  created_at: Date;
  employee_id: string;
  nombre_artistico: string;
  slug_catalogo: string;
  foto_perfil_url: string | null;
  last_id: string | null;
  last_sender: MessageSender | null;
  last_body: string | null;
  last_has_attachment: boolean | null;
  last_created_at: Date | null;
};

type FilaMensaje = {
  id: string;
  conversation_id: string;
  sender: MessageSender;
  body: string;
  attachment: MessageAttachment | null;
  client_message_id: string | null;
  created_at: Date;
};

/**
 * Chat web del cliente con el asistente de una modelo.
 *
 * Toda operacion parte de la ficha `Clientes` de la sesion y filtra por su
 * id: el cliente nunca indica de quien es la conversacion. Una conversacion
 * ajena responde 404, igual que una inexistente, para no revelar que existe.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    private readonly realtime: RealtimeEventsService,
    @Optional()
    @Inject(CONVERSATION_TURN_HANDLER)
    private readonly turnHandler?: ConversationTurnHandler,
  ) {}

  async listForClient(usuarioId: string): Promise<ResumenDeConversacion[]> {
    const clienteId = await this.resolveClienteId(usuarioId);
    return this.queryResumenes(clienteId);
  }

  /**
   * Abre el chat con una modelo o devuelve el que ya estaba abierto.
   *
   * `creada` le dice al controlador si responder 201 o 200.
   */
  async openWithEmployee(
    usuarioId: string,
    employeeId: string,
  ): Promise<{ conversation: ResumenDeConversacion; creada: boolean }> {
    const clienteId = await this.resolveClienteId(usuarioId);
    await this.assertModeloPublica(employeeId);

    const abierta = await this.findOpen(clienteId, employeeId);
    if (abierta) {
      return {
        conversation: await this.resumen(clienteId, abierta.id),
        creada: false,
      };
    }

    let creadaId: string;
    try {
      const nueva = await this.conversationsRepository.save(
        this.conversationsRepository.create({
          clientId: clienteId,
          employeeId,
          status: 'activa',
          mode: 'AI_ACTIVE',
        }),
      );
      creadaId = nueva.id;
    } catch (error) {
      // Dos pestañas pueden pedir el mismo chat a la vez: las dos ven que no
      // hay ninguno abierto y la segunda choca con el indice unico parcial.
      // Esa segunda devuelve la que gano en vez de un error.
      if (!esViolacionDe(error, UQ_OPEN_CONVERSATION)) throw error;
      const ganadora = await this.findOpen(clienteId, employeeId);
      if (!ganadora) throw error;
      return {
        conversation: await this.resumen(clienteId, ganadora.id),
        creada: false,
      };
    }
    return {
      conversation: await this.resumen(clienteId, creadaId),
      creada: true,
    };
  }

  /**
   * Pagina hacia atras: del mensaje mas reciente al mas antiguo. El cursor es
   * el id del ultimo mensaje entregado y se compara por `(created_at, id)` en
   * la base; asi no se pierde precision de microsegundos que un timestamp
   * pasado por JavaScript (milisegundos) si perderia, y dos mensajes del
   * mismo instante no se saltan.
   */
  async listMessages(
    usuarioId: string,
    conversationId: string,
    query: ListMessagesDto,
  ): Promise<PaginaDeMensajes> {
    const clienteId = await this.resolveClienteId(usuarioId);
    await this.findOwned(clienteId, conversationId);

    const limit = query.limit ?? DEFAULT_MESSAGES_PAGE;
    // Se pide uno de mas para saber si queda otra pagina sin un COUNT aparte.
    const filas: FilaMensaje[] = await this.dataSource.query(
      `SELECT m.id, m.conversation_id, m.sender, m.body, m.attachment,
              m.client_message_id, m.created_at
       FROM messages m
       WHERE m.conversation_id = $1
         AND ($2::uuid IS NULL OR (m.created_at, m.id) < (
               SELECT c.created_at, c.id FROM messages c
               WHERE c.id = $2::uuid AND c.conversation_id = $1))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      [conversationId, query.cursor ?? null, limit + 1],
    );

    const hayMas = filas.length > limit;
    const pagina = hayMas ? filas.slice(0, limit) : filas;
    return {
      items: pagina.map((fila) =>
        aMensajeDelChat({
          id: fila.id,
          conversationId: fila.conversation_id,
          sender: fila.sender,
          body: fila.body,
          attachment: fila.attachment,
          clientMessageId: fila.client_message_id,
          createdAt: fila.created_at,
        }),
      ),
      nextCursor: hayMas ? pagina[pagina.length - 1].id : null,
    };
  }

  /**
   * Guarda un mensaje del cliente. Idempotente por `clientMessageId`: el
   * reintento de un envio que si llego devuelve el mismo mensaje, sin
   * duplicarlo ni volver a avisar a nadie.
   *
   * `creado` le dice al controlador si responder 201 o 200.
   */
  async sendClientMessage(
    usuarioId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<{ message: MensajeDelChat; creado: boolean }> {
    const clienteId = await this.resolveClienteId(usuarioId);

    const resultado = await this.dataSource.transaction(async (manager) => {
      // El bloqueo de la fila serializa los envios de una misma conversacion:
      // con el, comprobar si el `clientMessageId` ya existe y despues insertar
      // no puede intercalarse con otro reintento, y `last_message_at` no
      // retrocede si dos mensajes se confirman en desorden.
      const conversation = await manager.findOne(Conversation, {
        where: { id: conversationId, clientId: clienteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation)
        throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);

      const existente = await manager.findOne(Message, {
        where: { conversationId, clientMessageId: dto.clientMessageId },
      });
      // Antes que el 409: un reintento de algo que se envio antes de cerrar
      // el chat sigue recibiendo su mensaje, no un error.
      if (existente) return { conversation, message: existente, creado: false };

      if (conversation.status === 'cerrada') {
        throw new ConflictException(
          'Esta conversación está cerrada; abre una nueva para seguir',
        );
      }

      const message = await manager.save(
        manager.create(Message, {
          conversationId,
          sender: 'cliente',
          body: dto.body ?? '',
          ...(dto.location ? { attachment: adjuntoDeUbicacion(dto) } : {}),
          clientMessageId: dto.clientMessageId,
        }),
      );
      await manager.update(
        Conversation,
        { id: conversationId },
        { lastMessageAt: message.createdAt },
      );
      conversation.lastMessageAt = message.createdAt;
      return { conversation, message, creado: true };
    });

    if (resultado.creado) {
      await this.avisarMensajeNuevo(
        clienteId,
        resultado.conversation,
        resultado.message,
      );
      this.lanzarTurno(resultado.conversation, resultado.message);
    }
    return {
      message: aMensajeDelChat(resultado.message),
      creado: resultado.creado,
    };
  }

  private async resolveClienteId(usuarioId: string): Promise<string> {
    const cliente = await this.clientesRepository.findOne({
      where: { usuarioId },
      select: { id: true },
    });
    if (!cliente) {
      throw new NotFoundException('Esta cuenta no tiene ficha de cliente');
    }
    return cliente.id;
  }

  private async findOwned(
    clienteId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationsRepository.findOne({
      where: { id: conversationId, clientId: clienteId },
    });
    if (!conversation) throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
    return conversation;
  }

  private findOpen(
    clienteId: string,
    employeeId: string,
  ): Promise<Conversation | null> {
    return this.conversationsRepository.findOne({
      where: { clientId: clienteId, employeeId, status: Not('cerrada') },
    });
  }

  /**
   * Mismo criterio que el catalogo publico (`EmployeesService.findAllActive`):
   * catalogo activo, usuario activo y sin sancion vigente. No se reutiliza ese
   * metodo porque carga y ordena a todas las modelos con fotos, extras y
   * disponibilidad; aqui basta con saber si una concreta es visible. Si el
   * criterio del catalogo cambia, hay que cambiar tambien este.
   *
   * Una modelo oculta responde 404, igual que una inexistente: el catalogo
   * tampoco revela que existe.
   */
  private async assertModeloPublica(employeeId: string): Promise<void> {
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT e.id
       FROM empleadas e
       INNER JOIN usuarios u ON u.id = e.usuario_id
       WHERE e.id = $1
         AND e.catalogo_activo = true
         AND u.activo = true
         AND NOT EXISTS (
           SELECT 1 FROM disciplinary_sanctions s
           WHERE s.subject_type = 'employee'
             AND s.subject_id = e.id
             AND s.status = 'active'
             AND s.starts_at <= now()
             AND (s.type = 'permanent_ban' OR s.ends_at > now()))`,
      [employeeId],
    );
    if (filas.length === 0) {
      throw new NotFoundException('Modelo no disponible');
    }
  }

  private async resumen(
    clienteId: string,
    conversationId: string,
  ): Promise<ResumenDeConversacion> {
    const [resumen] = await this.queryResumenes(clienteId, conversationId);
    if (!resumen) throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
    return resumen;
  }

  /**
   * Bandeja del cliente en una sola consulta: el ultimo mensaje sale de un
   * LATERAL que recorre el indice `(conversation_id, created_at, id)` hacia
   * atras y se detiene en la primera fila.
   */
  private async queryResumenes(
    clienteId: string,
    conversationId?: string,
  ): Promise<ResumenDeConversacion[]> {
    const filas: FilaResumen[] = await this.dataSource.query(
      `SELECT c.id, c.status, c.last_message_at, c.created_at,
              e.id AS employee_id, e.nombre_artistico, e.slug_catalogo,
              e.foto_perfil_url,
              m.id AS last_id, m.sender AS last_sender,
              LEFT(m.body, ${PREVIEW_LENGTH + 1}) AS last_body,
              (m.attachment IS NOT NULL) AS last_has_attachment,
              m.created_at AS last_created_at
       FROM conversations c
       INNER JOIN empleadas e ON e.id = c.employee_id
       LEFT JOIN LATERAL (
         SELECT id, sender, body, attachment, created_at
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) m ON true
       WHERE c.client_id = $1
         AND ($2::uuid IS NULL OR c.id = $2::uuid)
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT $3`,
      [clienteId, conversationId ?? null, MAX_CONVERSATIONS_LISTED],
    );
    return filas.map((fila) => ({
      id: fila.id,
      status: fila.status,
      lastMessageAt: fila.last_message_at,
      createdAt: fila.created_at,
      employee: {
        id: fila.employee_id,
        nombreArtistico: fila.nombre_artistico,
        slugCatalogo: fila.slug_catalogo,
        fotoPerfilUrl: fila.foto_perfil_url,
      },
      lastMessage: fila.last_id
        ? {
            id: fila.last_id,
            sender: fila.last_sender as MessageSender,
            preview: recortar(fila.last_body ?? ''),
            hasAttachment: Boolean(fila.last_has_attachment),
            createdAt: fila.last_created_at as Date,
          }
        : null,
    }));
  }

  /**
   * Avisa al propio cliente (sus otras pestañas) y a los jefes de la modelo,
   * que siguen el chat desde su panel. Sin jefe asignado, `emitToBosses` lo
   * reparte a todos los jefes y admins, igual que el resto de avisos.
   *
   * El mensaje ya esta guardado: si el aviso falla se registra y el cliente
   * recibe su respuesta igual; el panel lo vera al refrescar.
   */
  private async avisarMensajeNuevo(
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

  /**
   * Cede el turno al manejador registrado (la IA, desde el paso 6) sin
   * esperarlo: la respuesta al cliente no depende de que el asistente
   * conteste, y un fallo del asistente no puede convertir en error un mensaje
   * que ya quedo guardado.
   */
  private lanzarTurno(conversation: Conversation, message: Message): void {
    const handler = this.turnHandler;
    if (!handler) return;
    void Promise.resolve()
      .then(() => handler.onClientMessage(conversation, message))
      .catch((error: unknown) => {
        this.logger.error(
          `Fallo el turno de la conversacion ${conversation.id} tras el mensaje ${message.id}: ${describeError(error)}`,
        );
      });
  }
}

const CONVERSACION_NO_ENCONTRADA = 'Conversación no encontrada';

function aMensajeDelChat(message: {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string;
  attachment: MessageAttachment | null;
  clientMessageId: string | null;
  createdAt: Date;
}): MensajeDelChat {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: message.sender,
    body: message.body,
    attachment: message.attachment ? { type: message.attachment.type } : null,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
  };
}

/**
 * El pin viaja como adjunto del propio mensaje y no como mensaje aparte: asi
 * hereda su idempotencia y el turno de la reserva lo lee junto al texto que lo
 * acompañe.
 */
function adjuntoDeUbicacion(dto: SendMessageDto): MessageAttachment | null {
  if (!dto.location) return null;
  return {
    type: 'ubicacion',
    lat: dto.location.lat,
    lng: dto.location.lng,
    ...(dto.location.address ? { address: dto.location.address } : {}),
  };
}

function recortar(texto: string): string {
  return texto.length > PREVIEW_LENGTH
    ? `${texto.slice(0, PREVIEW_LENGTH).trimEnd()}...`
    : texto;
}

/**
 * `QueryFailedError` copia los campos del error de pg (`code`, `constraint`),
 * asi que se distingue que indice salto sin depender del texto del mensaje.
 */
function esViolacionDe(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint: violada } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  return code === '23505' && violada === constraint;
}
