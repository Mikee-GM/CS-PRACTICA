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
import { DataSource, Repository } from 'typeorm';
import { quitarEmojis } from '../ai/ai-guardrails';
import { palabrasVetadasEn } from '../ai/vocabulario-vetado';
import {
  aceptarBorradorDeReserva,
  type ResultadoDeAceptacion,
} from '../booking/aceptacion-de-borrador';
import {
  comprobanteEnCurso,
  enlazarComprobanteAServicio,
} from '../booking/booking-receipts';
import {
  estadoInicial,
  normalizarEstado,
  reiniciarReserva,
  type BookingState,
} from '../booking/booking-state';
import { ConflictoDeVersionError } from '../booking/booking.errors';
import type { ConversationRef } from '../booking/chat-channel';
import { describeError } from '../common/errors/error-message';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { PaymentReceiptValidations } from '../services/entities/payment-receipt-validation.entity';
import { Servicios } from '../services/entities/service.entity';
import { ServicesService } from '../services/services.service';
import { CustomerBookingSession } from '../booking/entities/customer-booking-session.entity';
import { Usuarios } from '../users/entities/user.entity';
import { jefeAlcanzaModelo, modelosAlAlcance } from './alcance-del-jefe';
import {
  admiteComprobante,
  joinServicioQueEsperaComprobante,
  lateralUltimoComprobante,
  METODOS_CON_COMPROBANTE,
  SERVICIO_CERRADO,
  VENTANA_ANALISIS_MS,
} from './comprobante-pendiente';
import {
  CONVERSATION_MODE_CHANGED,
  CONVERSATION_STATUS_CHANGED,
  ConversationModeChangedEvent,
  ConversationStatusChangedEvent,
  MESSAGE_CREATED,
  MessageCreatedEvent,
} from './conversation-events';
import {
  CONVERSATION_TURN_HANDLER,
  ConversationTurnHandler,
} from './conversation-turn-handler';
import { leerPaginaDeMensajes, PREVIEW_LENGTH } from './conversations.service';
import type { ListMessagesDto } from './dto/list-messages.dto';
import type {
  ListStaffConversationsDto,
  SendStaffMessageDto,
} from './dto/staff-conversations.dto';
import {
  Conversation,
  ConversationMode,
  ConversationStatus,
} from './entities/conversation.entity';
import {
  Message,
  MessageAttachment,
  MessageSender,
} from './entities/message.entity';
import { WebBookingStateStore } from './web-booking-state.store';
import { WebChatChannel } from './web-chat-channel';

/** Tope de la bandeja del equipo. */
export const MAX_STAFF_CONVERSATIONS_LISTED = 200;

/** Reintentos al guardar el estado si la IA lo cambio a la vez. */
const INTENTOS_DE_ESTADO = 3;

/**
 * Avisos del `sistema` que ve el cliente cuando actua el equipo. Hablan como
 * la plataforma, sin emojis y sin el vocabulario vetado del chat web
 * (`PALABRAS_VETADAS_WEB`): un spec los recorre. El de la toma de control
 * importa: lo que escriba despues el equipo se le pinta al cliente como de la
 * modelo, y sin el aviso parecería que sigue hablando la asistente virtual.
 */
export const TEXTOS_DEL_EQUIPO = {
  tomaDeControl: 'Una persona del equipo continúa esta conversación contigo.',
  retomaAsistente: (nombre: string) =>
    `La asistente virtual de ${nombre} retoma la conversación.`,
  retomaAsistenteGenerico: 'La asistente virtual retoma la conversación.',
  solicitudAprobada: (nombre: string) =>
    `Tu solicitud fue aprobada. Te avisaremos por aquí en cuanto ${nombre} confirme.`,
  solicitudAprobadaGenerica:
    'Tu solicitud fue aprobada. Te avisaremos por aquí en cuanto quede confirmada.',
  solicitudRechazada:
    'Esta vez no fue posible coordinar tu solicitud. Si quieres, puedes intentarlo de nuevo más tarde.',
} as const;

/** Por que una conversacion necesita que la mire alguien del equipo. */
export type MotivoDeAtencion =
  | 'entregada_al_equipo'
  | 'en_revision'
  | 'comprobante_en_revision'
  | 'fallos_ia'
  | 'cliente_sin_respuesta';

export type ConversacionDelEquipo = {
  id: string;
  status: ConversationStatus;
  mode: ConversationMode;
  humanOwnerId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  bookingSessionId: string | null;
  serviceId: string | null;
  employee: {
    id: string;
    nombreArtistico: string;
    fotoPerfilUrl: string | null;
  };
  /** `nombre` es el nombre de la cuenta o, si no tiene, su correo. */
  client: { id: string; nombre: string };
  lastMessage: {
    id: string;
    sender: MessageSender;
    preview: string;
    hasAttachment: boolean;
    createdAt: Date;
  } | null;
  requiereAtencion: boolean;
  motivosDeAtencion: MotivoDeAtencion[];
  /** Hay un comprobante en analisis, en revision o por confirmar con el CEP. */
  comprobanteEnRevision: boolean;
  /** El cliente puede mandar comprobante ahora (mismo criterio que el suyo). */
  comprobantePendiente: boolean;
};

/**
 * Mensaje visto por el equipo: a diferencia del cliente, del pin recibe las
 * coordenadas y del comprobante la validacion, para revisarlos.
 */
export type MensajeParaElEquipo = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string;
  attachment: {
    type: MessageAttachment['type'];
    url?: string;
    lat?: number;
    lng?: number;
    address?: string;
  } | null;
  receiptValidationId: string | null;
  clientMessageId: string | null;
  createdAt: Date;
};

export type ControlDeConversacion = {
  conversationId: string;
  mode: ConversationMode;
  humanOwnerId: string | null;
  humanTakenAt: Date | null;
};

export type DecisionSobreBorrador = {
  conversationId: string;
  status: ConversationStatus;
  bookingSessionId: string | null;
  serviceId: string | null;
  /** Ya estaba decidido; no se repitieron avisos. */
  idempotent: boolean;
};

type FilaBandeja = {
  id: string;
  status: ConversationStatus;
  mode: ConversationMode;
  human_owner_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
  booking_session_id: string | null;
  service_id: string | null;
  state: unknown;
  employee_id: string;
  nombre_artistico: string;
  foto_perfil_url: string | null;
  client_id: string;
  client_nombre: string;
  last_id: string | null;
  last_sender: MessageSender | null;
  last_body: string | null;
  last_has_attachment: boolean | null;
  last_created_at: Date | null;
  servicio_espera_comprobante: boolean;
  comprobante_estado: string | null;
  comprobante_created_at: Date | null;
  comprobante_confirmado_at: Date | null;
};

/** Estados de un comprobante que todavia puede acreditar el pago. */
const COMPROBANTE_VIGENTE = ['PROCESANDO', 'PENDIENTE_REVISION', 'APROBADO'];

/**
 * Chat web visto por el equipo (jefes y admins): bandeja, toma de control,
 * respuesta humana y decision sobre el borrador de reserva.
 *
 * El alcance se resuelve aqui, no en el controlador: un admin ve todo y un
 * jefe solo las conversaciones de las modelos que le tocan
 * (`jefeAlcanzaModelo`). Fuera de su alcance la conversacion responde 404,
 * igual que una inexistente, para no revelar que existe.
 *
 * Aceptar y rechazar son decisiones de jefe o admin; la modelo nunca decide
 * sobre su propio servicio (regla del proyecto, ver CLAUDE.md).
 */
@Injectable()
export class StaffConversationsService {
  private readonly logger = new Logger(StaffConversationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(CustomerBookingSession)
    private readonly borradoresRepository: Repository<CustomerBookingSession>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(PaymentReceiptValidations)
    private readonly validacionesRepository: Repository<PaymentReceiptValidations>,
    private readonly realtime: RealtimeEventsService,
    private readonly store: WebBookingStateStore,
    private readonly servicesService: ServicesService,
    @Optional()
    @Inject(CONVERSATION_TURN_HANDLER)
    private readonly turnHandler?: ConversationTurnHandler,
  ) {}

  // ---------------------------------------------------------------- lectura

  async listar(
    actor: Usuarios,
    filtro: ListStaffConversationsDto,
  ): Promise<ConversacionDelEquipo[]> {
    const modelos = await this.modelosAlAlcance(actor);
    if (modelos && modelos.length === 0) return [];

    const filas: FilaBandeja[] = await this.dataSource.query(
      `SELECT c.id, c.status, c.mode, c.human_owner_id, c.last_message_at,
              c.created_at, c.booking_session_id, c.service_id, c.state,
              e.id AS employee_id, e.nombre_artistico, e.foto_perfil_url,
              cl.id AS client_id,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''),
                       u.email, cl.nombre, 'Cliente') AS client_nombre,
              m.id AS last_id, m.sender AS last_sender,
              LEFT(m.body, ${PREVIEW_LENGTH + 1}) AS last_body,
              (m.attachment IS NOT NULL) AS last_has_attachment,
              m.created_at AS last_created_at,
              (sc.id IS NOT NULL) AS servicio_espera_comprobante,
              rc.estado AS comprobante_estado,
              rc.created_at AS comprobante_created_at,
              rc.pago_confirmado_at AS comprobante_confirmado_at
       FROM conversations c
       INNER JOIN empleadas e ON e.id = c.employee_id
       INNER JOIN clientes cl ON cl.id = c.client_id
       LEFT JOIN usuarios u ON u.id = cl.usuario_id
       LEFT JOIN LATERAL (
         SELECT id, sender, body, attachment, created_at
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) m ON true
       ${joinServicioQueEsperaComprobante('sc', 'c', '$5', '$6')}
       ${lateralUltimoComprobante('rc', 'c')}
       WHERE ($1::uuid[] IS NULL OR c.employee_id = ANY($1::uuid[]))
         AND (CASE WHEN $2::text IS NULL THEN c.status::text <> 'cerrada'
                   ELSE c.status::text = $2::text END)
         AND ($3::text IS NULL
              OR e.nombre_artistico ILIKE $3
              OR u.nombre ILIKE $3
              OR u.apellido ILIKE $3
              OR u.email ILIKE $3)
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT $4`,
      [
        modelos,
        filtro.estado ?? null,
        filtro.q ? `%${escaparLike(filtro.q)}%` : null,
        MAX_STAFF_CONVERSATIONS_LISTED,
        [...METODOS_CON_COMPROBANTE],
        [...SERVICIO_CERRADO],
      ],
    );

    const bandeja = filas.map(aConversacionDelEquipo);
    // Lo que pide atencion primero; dentro de cada grupo se conserva el orden
    // por ultimo mensaje de la consulta (`sort` es estable).
    return bandeja.sort(
      (a, b) => Number(b.requiereAtencion) - Number(a.requiereAtencion),
    );
  }

  async listarMensajes(
    actor: Usuarios,
    conversationId: string,
    query: ListMessagesDto,
  ): Promise<{ items: MensajeParaElEquipo[]; nextCursor: string | null }> {
    await this.conversacionAlAlcance(actor, conversationId);
    const { filas, nextCursor } = await leerPaginaDeMensajes(
      this.dataSource,
      conversationId,
      query,
    );
    return {
      items: filas.map((fila) => ({
        id: fila.id,
        conversationId: fila.conversation_id,
        sender: fila.sender,
        body: fila.body,
        attachment: adjuntoParaElEquipo(fila.attachment),
        receiptValidationId: fila.receipt_validation_id ?? null,
        clientMessageId: fila.client_message_id,
        createdAt: fila.created_at,
      })),
      nextCursor,
    };
  }

  // ------------------------------------------------------- toma de control

  /**
   * Una persona del equipo toma la conversacion: la IA deja de contestar
   * (`WebTurnHandler` mira el modo) y solo esa persona (o un admin) escribe.
   *
   * La comprobacion de quien la tiene va dentro del UPDATE: dos jefes que la
   * toman a la vez no pueden ganar los dos. El segundo recibe 409 con quien la
   * tiene. Un admin puede quitarsela a otro con `forzar`.
   */
  async tomarControl(
    actor: Usuarios,
    conversationId: string,
    forzar = false,
  ): Promise<ControlDeConversacion> {
    const conversation = await this.conversacionAlAlcance(
      actor,
      conversationId,
    );
    if (conversation.status === 'cerrada') throw conversacionCerrada();
    if (
      conversation.mode === 'HUMAN_ACTIVE' &&
      conversation.humanOwnerId === actor.id
    ) {
      return control(conversation);
    }

    const filas: Array<{ human_taken_at: Date }> = await this.dataSource.query(
      `WITH tomada AS (
         UPDATE conversations
            SET mode = 'HUMAN_ACTIVE',
                human_owner_id = $2,
                human_taken_at = now(),
                updated_at = now()
          WHERE id = $1
            AND status <> 'cerrada'
            AND (mode = 'AI_ACTIVE'
                 OR human_owner_id IS NULL
                 OR human_owner_id = $2
                 OR $3::boolean)
         RETURNING human_taken_at
       )
       SELECT human_taken_at FROM tomada`,
      [conversationId, actor.id, actor.rol === 'admin' && forzar],
    );
    if (!filas[0]) throw await this.conflictoDeControl(conversationId);

    const previoDueno = conversation.humanOwnerId;
    // El cliente solo se entera si antes le contestaba la IA; entre dos
    // personas del equipo el traspaso no le cambia nada.
    if (conversation.mode === 'AI_ACTIVE') {
      await this.avisarAlCliente(conversation, TEXTOS_DEL_EQUIPO.tomaDeControl);
    }
    await this.anunciarModo(conversation, 'HUMAN_ACTIVE', actor.id, [
      actor.id,
      previoDueno,
    ]);
    return {
      conversationId,
      mode: 'HUMAN_ACTIVE',
      humanOwnerId: actor.id,
      humanTakenAt: filas[0].human_taken_at,
    };
  }

  /**
   * Devuelve la conversacion a la IA y retira la entrega al equipo
   * (`entregadaAlEquipo`), que es lo que la mantenia callada aunque nadie la
   * hubiera tomado. Si el cliente escribio algo que nadie contesto, el turno
   * se lanza en el momento: no tiene que volver a escribir para que le
   * respondan.
   */
  async liberar(
    actor: Usuarios,
    conversationId: string,
    forzar = false,
  ): Promise<ControlDeConversacion> {
    const conversation = await this.conversacionAlAlcance(
      actor,
      conversationId,
    );
    if (conversation.status === 'cerrada') throw conversacionCerrada();

    const filas: Array<{ id: string }> = await this.dataSource.query(
      `WITH liberada AS (
         UPDATE conversations
            SET mode = 'AI_ACTIVE',
                human_owner_id = NULL,
                human_taken_at = NULL,
                updated_at = now()
          WHERE id = $1
            AND status <> 'cerrada'
            AND (mode = 'AI_ACTIVE'
                 OR human_owner_id IS NULL
                 OR human_owner_id = $2
                 OR $3::boolean)
         RETURNING id
       )
       SELECT id FROM liberada`,
      [conversationId, actor.id, actor.rol === 'admin' && forzar],
    );
    if (!filas[0]) throw await this.conflictoDeControl(conversationId);

    const estabaEnManosDelEquipo =
      conversation.mode === 'HUMAN_ACTIVE' ||
      Boolean(normalizarEstado(conversation.state).entregadaAlEquipo);
    // Lo que el cliente escribio despues de la ultima respuesta (de la IA,
    // del equipo o del sistema) no lo contesto nadie: el cursor vuelve a esa
    // respuesta para que el turno lo atienda. Se calcula antes de dejar el
    // aviso de abajo, que tambien es del sistema.
    const ultimaRespuesta = estabaEnManosDelEquipo
      ? await this.ultimaRespuestaId(conversationId)
      : null;
    await this.actualizarEstado(conversation, (estado) => {
      estado.entregadaAlEquipo = undefined;
      estado.motivoDeEntrega = undefined;
      estado.fallosIaSeguidos = 0;
      if (ultimaRespuesta) estado.ultimoMensajeAtendidoId = ultimaRespuesta;
    });

    if (estabaEnManosDelEquipo) {
      const nombre = await this.nombreDeLaModelo(conversation.employeeId);
      await this.avisarAlCliente(
        conversation,
        textoSeguro(
          nombre ? TEXTOS_DEL_EQUIPO.retomaAsistente(nombre) : '',
          TEXTOS_DEL_EQUIPO.retomaAsistenteGenerico,
        ),
      );
    }
    if (conversation.mode === 'HUMAN_ACTIVE') {
      await this.anunciarModo(conversation, 'AI_ACTIVE', null, [
        actor.id,
        conversation.humanOwnerId,
      ]);
    }
    this.atenderPendientes(conversationId);
    return {
      conversationId,
      mode: 'AI_ACTIVE',
      humanOwnerId: null,
      humanTakenAt: null,
    };
  }

  // ------------------------------------------------------- respuesta humana

  /**
   * Mensaje del equipo al cliente. Solo con la conversacion tomada y por quien
   * la tomo (o un admin): asi la IA y una persona nunca contestan a la vez.
   * Idempotente por `clientMessageId`, como el del cliente.
   *
   * Se guarda como `jefe`; el cliente lo ve como de la modelo.
   */
  async enviarMensaje(
    actor: Usuarios,
    conversationId: string,
    dto: SendStaffMessageDto,
  ): Promise<{ message: MensajeParaElEquipo; creado: boolean }> {
    await this.conversacionAlAlcance(actor, conversationId);
    // En el chat web no sale ningun emoji, lo escriba quien lo escriba (la
    // misma barrera que `WebChatChannel`).
    const cuerpo = quitarEmojis(dto.body).trim();
    if (!cuerpo) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }

    const resultado = await this.dataSource.transaction(async (manager) => {
      // Mismo protocolo que los mensajes del cliente: con la fila bloqueada,
      // un reintento no se intercala con otro ni con un cambio de modo.
      const conversation = await manager.findOne(Conversation, {
        where: { id: conversationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation) {
        throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
      }
      const existente = await manager.findOne(Message, {
        where: { conversationId, clientMessageId: dto.clientMessageId },
      });
      if (existente) return { conversation, message: existente, creado: false };

      if (conversation.status === 'cerrada') throw conversacionCerrada();
      if (conversation.mode !== 'HUMAN_ACTIVE') {
        throw new ConflictException(
          'Toma el control de la conversación antes de escribir',
        );
      }
      if (conversation.humanOwnerId !== actor.id && actor.rol !== 'admin') {
        throw new ConflictException(
          'La conversación la atiende otra persona del equipo',
        );
      }

      const message = await manager.save(
        manager.create(Message, {
          conversationId,
          sender: 'jefe',
          body: cuerpo,
          clientMessageId: dto.clientMessageId,
        }),
      );
      await manager.update(
        Conversation,
        { id: conversationId },
        { lastMessageAt: message.createdAt },
      );
      return { conversation, message, creado: true };
    });

    if (resultado.creado) {
      await this.anunciar(
        resultado.conversation,
        {
          type: MESSAGE_CREATED,
          data: { conversationId, messageId: resultado.message.id },
        } satisfies MessageCreatedEvent,
        [actor.id],
      );
    }
    const m = resultado.message;
    return {
      message: {
        id: m.id,
        conversationId: m.conversationId,
        sender: m.sender,
        body: m.body,
        attachment: adjuntoParaElEquipo(m.attachment ?? null),
        receiptValidationId: m.receiptValidationId ?? null,
        clientMessageId: m.clientMessageId ?? null,
        createdAt: m.createdAt,
      },
      creado: resultado.creado,
    };
  }

  // -------------------------------------------------- borrador de reserva

  /**
   * Acepta el borrador que dejo la IA: crea el servicio con
   * `aceptarBorradorDeReserva`, lo engancha a la conversacion, le pasa el
   * comprobante que ya hubiera y avisa al cliente.
   */
  async aceptar(
    actor: Usuarios,
    conversationId: string,
  ): Promise<DecisionSobreBorrador> {
    const conversation = await this.conversacionAlAlcance(
      actor,
      conversationId,
    );
    if (conversation.status === 'cerrada') throw conversacionCerrada();
    const draft = await this.borradorDe(conversation);
    const employee = await this.empleadasRepository.findOne({
      where: { id: draft.intendedEmployeeId ?? conversation.employeeId },
    });
    if (!employee) throw new NotFoundException('Modelo no encontrada');
    if (draft.status === 'CANCELLED' || draft.status === 'ABANDONED') {
      throw new ConflictException('Esta solicitud ya no está vigente');
    }

    let resultado: ResultadoDeAceptacion;
    if (draft.serviceId) {
      // Ya se acepto (quiza por otra via): solo se asegura el enlace.
      await this.enlazarServicio(conversationId, draft.serviceId);
      resultado = { draft, idempotent: true };
    } else {
      const estado = normalizarEstado(conversation.state);
      resultado = await aceptarBorradorDeReserva(
        {
          borradores: this.borradoresRepository,
          servicios: this.serviciosRepository,
          reservas: this.servicesService,
        },
        draft,
        employee,
        {
          actorId: actor.id,
          jefeId: jefeDelServicio(actor, employee),
          comprobantePendiente: Boolean(estado.esperandoComprobante),
          enlazarConversacion: (serviceId) =>
            this.enlazarServicio(conversationId, serviceId),
        },
      );
    }

    const serviceId = resultado.draft.serviceId ?? resultado.service?.id;
    if (!serviceId) {
      throw new ConflictException(
        'La reserva está siendo aceptada por otra persona',
      );
    }
    // Enlazar el comprobante y dejar el estado son idempotentes: tambien se
    // hacen al recuperar una aceptacion que se quedo a medias.
    await this.enlazarComprobantePendiente(conversationId, serviceId);
    // La marca de comprobante pendiente pasa al servicio, que es donde la
    // quita quien confirme el CEP; la reserva ya no esta en manos de la IA.
    await this.actualizarEstado(conversation, (estado) => {
      estado.lifecycle = 'SERVICE_CREATED';
      estado.esperandoComprobante = undefined;
      estado.paso = undefined;
    });
    if (resultado.idempotent) {
      return {
        conversationId,
        status: 'con_servicio',
        bookingSessionId: draft.id,
        serviceId,
        idempotent: true,
      };
    }

    await this.anunciarEstado(conversation, 'con_servicio', [actor.id]);
    await this.avisarAlCliente(
      conversation,
      textoSeguro(
        TEXTOS_DEL_EQUIPO.solicitudAprobada(employee.nombreArtistico ?? ''),
        TEXTOS_DEL_EQUIPO.solicitudAprobadaGenerica,
      ),
    );
    return {
      conversationId,
      status: 'con_servicio',
      bookingSessionId: draft.id,
      serviceId,
      idempotent: false,
    };
  }

  /**
   * Rechaza el borrador. El chat no se cierra: el cliente
   * puede volver a intentarlo en la misma conversacion, que vuelve a `activa`
   * con la reserva en blanco. La entrega al equipo, si la habia, se conserva:
   * la retira quien devuelva el control.
   */
  async rechazar(
    actor: Usuarios,
    conversationId: string,
    motivo?: string,
  ): Promise<DecisionSobreBorrador> {
    const conversation = await this.conversacionAlAlcance(
      actor,
      conversationId,
    );
    if (conversation.status === 'cerrada') throw conversacionCerrada();
    const draft = await this.borradorDe(conversation);
    if (draft.serviceId) {
      throw new ConflictException(
        'La solicitud ya se convirtió en servicio; cancélalo desde el servicio',
      );
    }

    // Condicionado por estado y sin servicio: no compite con una aceptacion
    // en curso (`ACCEPTING`), que gana si llego antes.
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `WITH cancelado AS (
         UPDATE customer_booking_sessions
            SET status = 'CANCELLED',
                current_requirement = NULL,
                version = version + 1,
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = now()
          WHERE id = $1
            AND service_id IS NULL
            AND status IN ('COLLECTING', 'READY', 'HUMAN_ACTIVE')
         RETURNING id
       )
       SELECT id FROM cancelado`,
      [
        draft.id,
        JSON.stringify({
          rechazo: {
            motivo: motivo?.trim() || null,
            porUsuarioId: actor.id,
            at: new Date().toISOString(),
            canal: 'web',
          },
        }),
      ],
    );
    if (!filas[0] && draft.status !== 'CANCELLED') {
      throw new ConflictException(
        'La reserva está siendo aceptada por otra persona',
      );
    }
    const idempotent = !filas[0];

    const actualizada: Array<{ status: ConversationStatus }> =
      await this.dataSource.query(
        `WITH suelta AS (
           UPDATE conversations
              SET booking_session_id = NULL,
                  status = CASE WHEN status = 'en_revision'
                                THEN 'activa'::conversations_status_enum
                                ELSE status END,
                  updated_at = now()
            WHERE id = $1 AND booking_session_id = $2
           RETURNING status
         )
         SELECT status FROM suelta`,
        [conversationId, draft.id],
      );
    const status = actualizada[0]?.status ?? conversation.status;

    // Se limpia y se avisa solo si esta llamada solto el borrador: un
    // reintento tras un fallo a medias termina el trabajo, uno repetido no
    // vuelve a avisar.
    if (actualizada[0]) {
      await this.actualizarEstado(conversation, (estado) => {
        const limpio = reiniciarReserva(estado);
        limpio.entregadaAlEquipo = estado.entregadaAlEquipo;
        limpio.motivoDeEntrega = estado.motivoDeEntrega;
        Object.keys(estado).forEach((clave) => {
          delete (estado as unknown as Record<string, unknown>)[clave];
        });
        Object.assign(estado, limpio);
      });
      await this.anunciarEstado(conversation, status, [actor.id]);
      await this.avisarAlCliente(
        conversation,
        TEXTOS_DEL_EQUIPO.solicitudRechazada,
      );
    }
    return {
      conversationId,
      status,
      bookingSessionId: null,
      serviceId: null,
      idempotent,
    };
  }

  // ------------------------------------------------------------- alcance

  /**
   * `null` para el admin (todas); para un jefe, las modelos que le tocan. La
   * regla vive en `alcance-del-jefe.ts`, compartida con la cola de posts.
   */
  private modelosAlAlcance(actor: Usuarios): Promise<string[] | null> {
    return modelosAlAlcance(this.empleadasRepository, actor);
  }

  private async conversacionAlAlcance(
    actor: Usuarios,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationsRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
    if (actor.rol === 'admin') return conversation;
    if (actor.rol !== 'jefe') {
      throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
    }
    const modelo = await this.empleadasRepository.findOne({
      where: { id: conversation.employeeId },
      relations: { jefe: true, jefeSecundario: true },
    });
    if (!modelo || !jefeAlcanzaModelo(actor.id, modelo)) {
      throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);
    }
    return conversation;
  }

  // ------------------------------------------------------------ auxiliares

  private async borradorDe(
    conversation: Conversation,
  ): Promise<CustomerBookingSession> {
    if (!conversation.bookingSessionId) {
      throw new ConflictException(
        'La conversación no tiene una solicitud por decidir',
      );
    }
    const draft = await this.borradoresRepository.findOne({
      where: { id: conversation.bookingSessionId },
    });
    if (!draft)
      throw new NotFoundException('Borrador de reserva no encontrado');
    return draft;
  }

  private async enlazarServicio(
    conversationId: string,
    serviceId: string,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE conversations
          SET service_id = $2,
              status = CASE WHEN status = 'cerrada' THEN status
                            ELSE 'con_servicio'::conversations_status_enum END,
              updated_at = now()
        WHERE id = $1 AND (service_id IS NULL OR service_id = $2)`,
      [conversationId, serviceId],
    );
  }

  /**
   * El comprobante que llego con la reserva en borrador no tenia servicio al
   * que pegarse; sin enlazarlo el equipo no podria confirmar el CEP desde el
   * servicio. Se toma el ultimo que todavia vale (no rechazado ni fallido).
   * Si su analisis sigue en curso, el propio analisis lo enlaza al terminar.
   */
  private async enlazarComprobantePendiente(
    conversationId: string,
    serviceId: string,
  ): Promise<void> {
    try {
      const filas: Array<{ id: string }> = await this.dataSource.query(
        `SELECT v.id
         FROM messages m
         INNER JOIN payment_receipt_validations v
                 ON v.id = m.receipt_validation_id
         WHERE m.conversation_id = $1
           AND v.servicio_id IS NULL
           AND v.estado = ANY($2::text[])
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1`,
        [conversationId, COMPROBANTE_VIGENTE],
      );
      const validationId = filas[0]?.id;
      if (!validationId) return;
      await enlazarComprobanteAServicio(
        {
          servicios: this.serviciosRepository,
          validaciones: this.validacionesRepository,
        },
        this.realtime,
        serviceId,
        validationId,
        (error) =>
          this.logger.error(
            `No se pudo enlazar el comprobante ${validationId} al servicio ${serviceId}: ${describeError(error)}`,
          ),
      );
    } catch (error) {
      // El servicio ya existe; un fallo aqui no deshace la aceptacion.
      this.logger.error(
        `No se pudo buscar el comprobante de la conversacion ${conversationId} para el servicio ${serviceId}: ${describeError(error)}`,
      );
    }
  }

  private async ultimaRespuestaId(
    conversationId: string,
  ): Promise<string | null> {
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM messages
       WHERE conversation_id = $1 AND sender <> 'cliente'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [conversationId],
    );
    return filas[0]?.id ?? null;
  }

  /**
   * Cambia el estado de la reserva sin pisar lo que la IA guarde a la vez:
   * si la version cambio entre leer y escribir, se relee y se vuelve a
   * aplicar el cambio.
   */
  private async actualizarEstado(
    conversation: Conversation,
    cambiar: (estado: BookingState) => void,
  ): Promise<void> {
    const ref = refDe(conversation);
    for (let intento = 1; ; intento += 1) {
      const cargado = await this.store.load(ref);
      const estado = cargado?.state ?? estadoInicial();
      cambiar(estado);
      try {
        await this.store.save(ref, estado, cargado?.version ?? 0);
        return;
      } catch (error) {
        if (
          !(error instanceof ConflictoDeVersionError) ||
          intento >= INTENTOS_DE_ESTADO
        ) {
          throw error;
        }
      }
    }
  }

  private async conflictoDeControl(
    conversationId: string,
  ): Promise<ConflictException> {
    const filas: Array<{
      status: ConversationStatus;
      human_owner_id: string | null;
      nombre: string | null;
    }> = await this.dataSource.query(
      `SELECT c.status, c.human_owner_id,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''),
                       u.email) AS nombre
       FROM conversations c
       LEFT JOIN usuarios u ON u.id = c.human_owner_id
       WHERE c.id = $1`,
      [conversationId],
    );
    const fila = filas[0];
    if (!fila) return new ConflictException(CONVERSACION_NO_ENCONTRADA);
    if (fila.status === 'cerrada') return conversacionCerrada();
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'La conversación la atiende otra persona del equipo',
      humanOwner: fila.human_owner_id
        ? { id: fila.human_owner_id, nombre: fila.nombre ?? null }
        : null,
    });
  }

  private async nombreDeLaModelo(employeeId: string): Promise<string | null> {
    const modelo = await this.empleadasRepository.findOne({
      where: { id: employeeId },
      select: { id: true, nombreArtistico: true },
    });
    return modelo?.nombreArtistico?.trim() || null;
  }

  /**
   * Aviso del `sistema` al cliente por el canal web, que lo guarda y lo
   * anuncia al cliente y a los jefes. Nunca lanza: la decision ya esta
   * tomada y un aviso fallido no la deshace.
   */
  private async avisarAlCliente(
    conversation: Conversation,
    texto: string,
  ): Promise<void> {
    const canal = new WebChatChannel(
      this.dataSource,
      this.empleadasRepository,
      this.realtime,
      { pausaMaximaMs: 0 },
    );
    try {
      await canal.sendText(refDe(conversation), texto, { sender: 'sistema' });
    } catch (error) {
      this.logger.error(
        `No se pudo dejar el aviso del equipo en la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }

  /** El modo solo lo ven los jefes: al cliente no se le expone. */
  private async anunciarModo(
    conversation: Conversation,
    mode: ConversationMode,
    humanOwnerId: string | null,
    tambien: Array<string | null | undefined>,
  ): Promise<void> {
    const evento: ConversationModeChangedEvent = {
      type: CONVERSATION_MODE_CHANGED,
      data: { conversationId: conversation.id, mode, humanOwnerId },
    };
    try {
      this.realtime.emitToBosses(
        [...(await this.jefesDe(conversation)), ...tambien],
        evento,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo anunciar el cambio de modo de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }

  private anunciarEstado(
    conversation: Conversation,
    status: ConversationStatus,
    tambien: Array<string | null | undefined>,
  ): Promise<void> {
    return this.anunciar(
      conversation,
      {
        type: CONVERSATION_STATUS_CHANGED,
        data: { conversationId: conversation.id, status },
      } satisfies ConversationStatusChangedEvent,
      tambien,
    );
  }

  /**
   * Al cliente y a los jefes de la modelo, mas quien actuo: un jefe que la
   * atiende por relevo no es jefe de la modelo y no lo recibiria.
   */
  private async anunciar(
    conversation: Conversation,
    evento: { type: string; data: object },
    tambien: Array<string | null | undefined>,
  ): Promise<void> {
    try {
      this.realtime.emitToClient(conversation.clientId, evento);
      this.realtime.emitToBosses(
        [...(await this.jefesDe(conversation)), ...tambien],
        evento,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo anunciar ${evento.type} de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }

  private async jefesDe(
    conversation: Conversation,
  ): Promise<Array<string | null | undefined>> {
    const modelo = await this.empleadasRepository.findOne({
      where: { id: conversation.employeeId },
      select: { id: true, jefeId: true, jefeSecundarioId: true },
    });
    return [modelo?.jefeId, modelo?.jefeSecundarioId];
  }

  /** Sin esperar: la respuesta HTTP no depende de lo que tarde la IA. */
  private atenderPendientes(conversationId: string): void {
    const handler = this.turnHandler;
    if (!handler?.procesarPendientes) return;
    void Promise.resolve()
      .then(() => handler.procesarPendientes!(conversationId))
      .catch((error: unknown) =>
        this.logger.error(
          `Fallo el turno al devolver la conversacion ${conversationId} al asistente: ${describeError(error)}`,
        ),
      );
  }
}

const CONVERSACION_NO_ENCONTRADA = 'Conversación no encontrada';

function conversacionCerrada(): ConflictException {
  return new ConflictException('Esta conversación está cerrada');
}

function control(conversation: Conversation): ControlDeConversacion {
  return {
    conversationId: conversation.id,
    mode: conversation.mode,
    humanOwnerId: conversation.humanOwnerId ?? null,
    humanTakenAt: conversation.humanTakenAt ?? null,
  };
}

function refDe(conversation: Conversation): ConversationRef {
  return {
    clienteId: conversation.clientId,
    empleadaId: conversation.employeeId,
    bookingSessionId: conversation.bookingSessionId ?? null,
    channel: 'web',
    conversationId: conversation.id,
  };
}

/**
 * Jefe al que queda el servicio. Lo normal es el principal de la modelo; un
 * jefe que acepta por relevo (no es ni principal ni secundario) se lo queda
 * el, porque `ServicesService.ofrecerAEmpleada` solo deja gestionarlo al jefe
 * del servicio o a los de la modelo.
 */
export function jefeDelServicio(
  actor: Pick<Usuarios, 'id' | 'rol'>,
  employee: Pick<Empleadas, 'jefeId' | 'jefeSecundarioId'>,
): string {
  if (
    actor.rol === 'jefe' &&
    employee.jefeId !== actor.id &&
    employee.jefeSecundarioId !== actor.id
  ) {
    return actor.id;
  }
  return employee.jefeId ?? actor.id;
}

/**
 * El nombre artistico lo escribe una persona y podria traer una palabra
 * vetada; en ese caso se usa el texto sin nombre.
 */
export function textoSeguro(texto: string, respaldo: string): string {
  const limpio = texto.trim();
  if (!limpio || palabrasVetadasEn(limpio).length > 0) return respaldo;
  return limpio;
}

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function adjuntoParaElEquipo(
  adjunto: MessageAttachment | null,
): MensajeParaElEquipo['attachment'] {
  if (!adjunto) return null;
  if (adjunto.type === 'ubicacion') {
    return {
      type: adjunto.type,
      lat: adjunto.lat,
      lng: adjunto.lng,
      ...(adjunto.address ? { address: adjunto.address } : {}),
    };
  }
  return adjunto.url
    ? { type: adjunto.type, url: adjunto.url }
    : { type: adjunto.type };
}

function recortar(texto: string): string {
  return texto.length > PREVIEW_LENGTH
    ? `${texto.slice(0, PREVIEW_LENGTH).trimEnd()}...`
    : texto;
}

export function aConversacionDelEquipo(
  fila: FilaBandeja,
  ahora: number = Date.now(),
): ConversacionDelEquipo {
  const estado = normalizarEstado(fila.state);
  const ultimoComprobante = fila.comprobante_created_at
    ? {
        estado: fila.comprobante_estado,
        createdAt: fila.comprobante_created_at,
      }
    : null;
  const comprobanteEnRevision =
    !fila.comprobante_confirmado_at &&
    comprobanteEnCurso(
      ultimoComprobante
        ? {
            estado: ultimoComprobante.estado ?? undefined,
            createdAt: ultimoComprobante.createdAt,
          }
        : null,
      VENTANA_ANALISIS_MS,
      ahora,
    );

  const motivos: MotivoDeAtencion[] = [];
  if (estado.entregadaAlEquipo) motivos.push('entregada_al_equipo');
  if (fila.status === 'en_revision') motivos.push('en_revision');
  if (comprobanteEnRevision) motivos.push('comprobante_en_revision');
  if (estado.fallosIaSeguidos > 0) motivos.push('fallos_ia');
  // Con servicio la IA ya no contesta: lo que escriba el cliente lo tiene que
  // ver alguien del equipo.
  if (fila.status === 'con_servicio' && fila.last_sender === 'cliente') {
    motivos.push('cliente_sin_respuesta');
  }

  return {
    id: fila.id,
    status: fila.status,
    mode: fila.mode,
    humanOwnerId: fila.human_owner_id,
    lastMessageAt: fila.last_message_at,
    createdAt: fila.created_at,
    bookingSessionId: fila.booking_session_id,
    serviceId: fila.service_id,
    employee: {
      id: fila.employee_id,
      nombreArtistico: fila.nombre_artistico,
      fotoPerfilUrl: fila.foto_perfil_url,
    },
    client: { id: fila.client_id, nombre: fila.client_nombre },
    lastMessage: fila.last_id
      ? {
          id: fila.last_id,
          sender: fila.last_sender as MessageSender,
          preview: recortar(fila.last_body ?? ''),
          hasAttachment: Boolean(fila.last_has_attachment),
          createdAt: fila.last_created_at as Date,
        }
      : null,
    requiereAtencion: motivos.length > 0,
    motivosDeAtencion: motivos,
    comprobanteEnRevision,
    comprobantePendiente: admiteComprobante(
      {
        status: fila.status,
        estado: fila.state,
        servicioLoEspera: Boolean(fila.servicio_espera_comprobante),
        ultimoComprobante,
      },
      ahora,
    ),
  };
}
