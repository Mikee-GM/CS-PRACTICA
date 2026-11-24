import {
  BadRequestException,
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
import {
  condicionModeloVisible,
  joinUsuarioDeModelo,
} from '../employees/modelo-visible';
import { RealtimeEventsService } from '../realtime/realtime.service';
import {
  admiteComprobante,
  joinServicioQueEsperaComprobante,
  lateralUltimoComprobante,
  METODOS_CON_COMPROBANTE,
  SERVICIO_CERRADO,
} from './comprobante-pendiente';
import { MESSAGE_CREATED, MessageCreatedEvent } from './conversation-events';
import {
  CONVERSATION_TURN_HANDLER,
  ConversationTurnHandler,
} from './conversation-turn-handler';
import {
  ListMessagesDto,
  DEFAULT_MESSAGES_PAGE,
} from './dto/list-messages.dto';
import { SendMediaDto } from './dto/send-media.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  UploadService,
  type UploadedFilePayload,
} from '../upload/upload.service';
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
  /**
   * El cliente puede mandar ahora el comprobante de su transferencia. Es el
   * mismo criterio con el que `POST /conversations/:id/receipt` lo acepta
   * (`admiteComprobante`): si es `false`, la subida responderia 409.
   */
  comprobantePendiente: boolean;
};

export type MensajeDelChat = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string;
  /**
   * El tipo y, en `comprobante` y `foto`, la URL publica del archivo en R2,
   * para que el cliente vea lo que el mismo mando. Del pin solo va el tipo.
   */
  attachment: {
    type: MessageAttachment['type'];
    url?: string;
    durationMs?: number;
  } | null;
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
  state: unknown;
  servicio_espera_comprobante: boolean;
  comprobante_estado: string | null;
  comprobante_created_at: Date | null;
};

export type FilaMensaje = {
  id: string;
  conversation_id: string;
  sender: MessageSender;
  body: string;
  attachment: MessageAttachment | null;
  client_message_id: string | null;
  receipt_validation_id: string | null;
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
    // Al final y opcional: solo lo usan las fotos y los audios, y asi los
    // especs que construyen el servicio por posicion siguen igual.
    @Optional() private readonly uploadService?: UploadService,
  ) {}

  async listForClient(usuarioId: string): Promise<ResumenDeConversacion[]> {
    const clienteId = await this.resolveClienteId(usuarioId);
    return this.queryResumenes(clienteId);
  }

  /**
   * Una sola conversacion, para la cabecera del chat sin cargar la bandeja.
   * Ajena o inexistente responde 404, como el resto de rutas.
   */
  async getForClient(
    usuarioId: string,
    conversationId: string,
  ): Promise<ResumenDeConversacion> {
    const clienteId = await this.resolveClienteId(usuarioId);
    return this.resumen(clienteId, conversationId);
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

    const { filas, nextCursor } = await leerPaginaDeMensajes(
      this.dataSource,
      conversationId,
      query,
    );
    return {
      items: filas.map((fila) =>
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
      nextCursor,
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

  /**
   * Foto o nota de voz del cliente. Misma garantia que el texto: el
   * `clientMessageId` hace idempotente el reintento y el archivo no se sube si
   * la conversacion no admite mensajes.
   */
  async sendClientMedia(
    usuarioId: string,
    conversationId: string,
    archivo: UploadedFilePayload | undefined,
    dto: SendMediaDto,
  ): Promise<{ message: MensajeDelChat; creado: boolean }> {
    const clienteId = await this.resolveClienteId(usuarioId);
    if (!archivo?.buffer?.length) {
      throw new BadRequestException('Adjunta una foto o un audio');
    }

    const previo = await this.dataSource.getRepository(Message).findOne({
      where: { conversationId, clientMessageId: dto.clientMessageId },
    });
    const propia = await this.findOwned(clienteId, conversationId);
    if (previo) return { message: aMensajeDelChat(previo), creado: false };
    if (propia.status === 'cerrada') {
      throw new ConflictException(
        'Esta conversación está cerrada; abre una nueva para seguir',
      );
    }

    const subida = await this.subidas().uploadChatMedia({
      buffer: archivo.buffer,
      declaredType: archivo.mimetype ?? '',
      conversationId,
    });
    const attachment = adjuntoDeMedia(subida, dto);

    const resultado = await this.dataSource.transaction(async (manager) => {
      const conversation = await manager.findOne(Conversation, {
        where: { id: conversationId, clientId: clienteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation)
        throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
      const existente = await manager.findOne(Message, {
        where: { conversationId, clientMessageId: dto.clientMessageId },
      });
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
          attachment,
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

  private subidas(): UploadService {
    if (!this.uploadService) {
      throw new Error('El servicio de subida de archivos no esta disponible');
    }
    return this.uploadService;
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
   * Mismo criterio que el catalogo publico y el feed (`modelo-visible.ts`).
   * No se reutiliza `EmployeesService.findAllActive` porque carga y ordena a
   * todas las modelos con fotos, extras y disponibilidad; aqui basta con
   * saber si una concreta es visible.
   *
   * Una modelo oculta responde 404, igual que una inexistente: el catalogo
   * tampoco revela que existe.
   */
  private async assertModeloPublica(employeeId: string): Promise<void> {
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT e.id
       FROM empleadas e
       ${joinUsuarioDeModelo('e', 'u')}
       WHERE e.id = $1
         AND ${condicionModeloVisible('e', 'u')}`,
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
              m.created_at AS last_created_at,
              c.state,
              (sc.id IS NOT NULL) AS servicio_espera_comprobante,
              rc.estado AS comprobante_estado,
              rc.created_at AS comprobante_created_at
       FROM conversations c
       INNER JOIN empleadas e ON e.id = c.employee_id
       LEFT JOIN LATERAL (
         SELECT id, sender, body, attachment, created_at
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) m ON true
       ${joinServicioQueEsperaComprobante('sc', 'c', '$4', '$5')}
       ${lateralUltimoComprobante('rc', 'c')}
       WHERE c.client_id = $1
         AND ($2::uuid IS NULL OR c.id = $2::uuid)
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT $3`,
      [
        clienteId,
        conversationId ?? null,
        MAX_CONVERSATIONS_LISTED,
        [...METODOS_CON_COMPROBANTE],
        [...SERVICIO_CERRADO],
      ],
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
      comprobantePendiente: admiteComprobante({
        status: fila.status,
        estado: fila.state,
        servicioLoEspera: Boolean(fila.servicio_espera_comprobante),
        ultimoComprobante: fila.comprobante_created_at
          ? {
              estado: fila.comprobante_estado,
              createdAt: fila.comprobante_created_at,
            }
          : null,
      }),
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

/** El adjunto que se guarda para una foto o una nota de voz ya subida. */
export function adjuntoDeMedia(
  subida: { url: string; kind: 'foto' | 'audio'; mimeType: string; bytes: number },
  dto: { durationMs?: number },
): MessageAttachment {
  return {
    type: subida.kind,
    url: subida.url,
    mimeType: subida.mimeType,
    sizeBytes: subida.bytes,
    ...(subida.kind === 'audio' && dto.durationMs
      ? { durationMs: Math.round(dto.durationMs) }
      : {}),
  };
}

/**
 * Una pagina de mensajes, comun al cliente y al equipo: cada uno decide antes
 * si puede ver la conversacion y despues que deja ver de cada fila.
 */
export async function leerPaginaDeMensajes(
  dataSource: DataSource,
  conversationId: string,
  query: ListMessagesDto,
): Promise<{ filas: FilaMensaje[]; nextCursor: string | null }> {
  const limit = query.limit ?? DEFAULT_MESSAGES_PAGE;
  // Se pide uno de mas para saber si queda otra pagina sin un COUNT aparte.
  const filas: FilaMensaje[] = await dataSource.query(
    `SELECT m.id, m.conversation_id, m.sender, m.body, m.attachment,
            m.client_message_id, m.receipt_validation_id, m.created_at
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
    filas: pagina,
    nextCursor: hayMas ? pagina[pagina.length - 1].id : null,
  };
}

export function aMensajeDelChat(message: {
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
    attachment: adjuntoParaElCliente(message.attachment),
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
  };
}

function adjuntoParaElCliente(
  adjunto: MessageAttachment | null,
): MensajeDelChat['attachment'] {
  if (!adjunto) return null;
  if (
    (adjunto.type === 'comprobante' ||
      adjunto.type === 'foto' ||
      adjunto.type === 'audio') &&
    adjunto.url
  ) {
    return {
      type: adjunto.type,
      url: adjunto.url,
      ...(adjunto.type === 'audio' && adjunto.durationMs
        ? { durationMs: adjunto.durationMs }
        : {}),
    };
  }
  return { type: adjunto.type };
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
