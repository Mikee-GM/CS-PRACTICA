import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { quitarEmojis } from '../ai/ai-guardrails';
import { cuentasParaTransferir } from '../booking/booking-receipts';
import { describeError } from '../common/errors/error-message';
import { APP_LOCALE } from '../common/locale';
import { fromCents, toCents } from '../common/money';
import {
  modeloAlAlcance,
  modelosAlAlcance,
} from '../conversations/alcance-del-jefe';
import {
  CONVERSATION_MODE_CHANGED,
  type ConversationModeChangedEvent,
} from '../conversations/conversation-events';
import { ConversationNotifier } from '../conversations/conversation-notifier';
import { TEXTOS_DEL_EQUIPO } from '../conversations/staff-conversations.service';
import { Conversation } from '../conversations/entities/conversation.entity';
import {
  Message,
  type MessageAttachment,
  type MessageSender,
} from '../conversations/entities/message.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { textoWebSeguro } from '../services/aviso-al-cliente-web';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import type { Servicios } from '../services/entities/service.entity';
import type { Usuarios } from '../users/entities/user.entity';
import type { GroupServiceRequest } from './entities/group-service-request.entity';

type Actor = Pick<Usuarios, 'id' | 'rol'>;

/** Mensajes que se le muestran al jefe en la solicitud grupal. */
export const MAX_MENSAJES_DEL_GRUPO = 200;
/** Pedidos de grupo del chat que se listan como mucho. */
export const MAX_PEDIDOS_PENDIENTES = 50;

/**
 * Estados en que una solicitud sigue viva. Una conversacion con una de estas
 * ya no es un pedido pendiente; `confirmada` incluida, porque ya tiene servicio.
 */
export const ESTADOS_DE_SOLICITUD_VIVA = [
  'esperando_jefe',
  'seleccionando',
  'reservada',
  'esperando_pago',
  'confirmada',
] as const;

/**
 * Lo que el cliente lee en su chat sobre el servicio grupal. Hablan como la
 * casa, sin emojis y sin ninguna de `PALABRAS_VETADAS_WEB` (un spec los
 * recorre): el cliente no sabe quien coordina ni como se reparte el trabajo.
 */
export const TEXTOS_DEL_GRUPO_WEB = {
  // El mismo aviso que la bandeja al tomar el control: es el mismo hecho.
  tomaDeControl: TEXTOS_DEL_EQUIPO.tomaDeControl,
  pedirUbicacion:
    'Para coordinar tu servicio necesitamos la ubicación. Compártela con el botón de ubicación del chat o escribe la dirección.',
  comprobanteRechazado: (motivo: string | null) =>
    `Tu comprobante no se pudo validar tras revisarlo${motivo ? `: ${motivo}` : ''}. Envía un nuevo comprobante por aquí, por favor.`,
  comprobanteRechazadoGenerico:
    'Tu comprobante no se pudo validar tras revisarlo. Envía un nuevo comprobante por aquí, por favor.',
  pagoCompleto:
    'Recibimos tu pago completo. Tu servicio grupal queda confirmado.',
} as const;

const FORMATO_MONEDA = new Intl.NumberFormat(APP_LOCALE, {
  style: 'currency',
  currency: 'MXN',
});

const NOMBRES_DE_PAGO: Record<string, string> = {
  efectivo: 'efectivo',
  tarjeta: 'tarjeta',
  transferencia: 'transferencia',
  mixto: 'pago mixto',
};

/** Pedido grupal del chat web que todavia no tiene solicitud. */
export type PedidoGrupalDelChat = {
  conversationId: string;
  clientId: string;
  clientNombre: string;
  employeeId: string;
  nombreArtistico: string;
  lastMessageAt: Date | null;
};

/**
 * Un mensaje de la conversacion web con la forma de los mensajes de Telegram
 * que ya pinta el panel de grupos (`ConversationMessage` del frontend), para
 * que la misma vista sirva para los dos canales.
 */
export type MensajeDelGrupo = {
  id: string;
  clienteId: string;
  servicioId: string | null;
  groupRequestId: string;
  emisor: MessageSender;
  mensaje: string;
  attachment:
    | { type: 'photo'; url: string }
    | {
        type: 'location';
        latitude: number;
        longitude: number;
        address?: string;
      }
    | null;
  iaActiva: false;
  enviadoAt: Date;
};

/** Lo que hace falta del servicio para cotizarlo. */
export type ServicioCotizable = Pick<
  Servicios,
  | 'id'
  | 'metodoPago'
  | 'duracionPactadaHoras'
  | 'totalFinal'
  | 'totalPaid'
  | 'pendingBalance'
  | 'customerTransportCharge'
> & {
  participantes?: Array<{
    status: string;
    employee?: { nombreArtistico?: string | null } | null;
  }>;
};

/**
 * La cotizacion como la lee el cliente. Pura para poder probarla sin base: el
 * importe sale de los totales que ya calculo PostgreSQL y aqui solo se
 * presenta (en centavos para que el desglose cuadre con el total).
 */
export function textoDeCotizacion(
  servicio: ServicioCotizable,
  cuentas: string | null,
): string {
  const nombres = (servicio.participantes ?? [])
    .filter((p) => p.status !== 'cancelada')
    .map((p) => p.employee?.nombreArtistico?.trim())
    .filter((nombre): nombre is string => Boolean(nombre));
  const total = toCents(servicio.totalFinal);
  const transporte = toCents(servicio.customerTransportCharge);
  const pagado = toCents(servicio.totalPaid);
  const saldo = toCents(servicio.pendingBalance);
  const horas = Number(servicio.duracionPactadaHoras);

  const lineas = ['Cotización de tu servicio grupal'];
  if (nombres.length) {
    lineas.push(`Te acompañan: ${nombres.join(', ')}`);
  }
  if (Number.isFinite(horas) && horas > 0) {
    lineas.push(`Duración: ${horas} ${horas === 1 ? 'hora' : 'horas'}`);
  }
  if (transporte > 0) {
    lineas.push(`Traslado: ${dinero(transporte)}`);
  }
  lineas.push(`Total: ${dinero(total)}`);
  if (pagado > 0) lineas.push(`Pagado: ${dinero(pagado)}`);
  lineas.push(
    `Forma de pago: ${NOMBRES_DE_PAGO[servicio.metodoPago] ?? servicio.metodoPago}`,
  );

  const cuerpo = lineas.join('\n');
  if (servicio.metodoPago !== 'transferencia' || saldo <= 0) return cuerpo;
  return `${cuerpo}\n\n${textoDeSaldo(saldo, cuentas)}`;
}

/** El saldo por transferir y a donde. Sin cuentas no se inventan. */
export function textoDeSaldo(saldoCentavos: number, cuentas: string | null) {
  const cuanto = `Saldo por transferir: ${dinero(saldoCentavos)}`;
  const comprobante =
    'Cuando lo tengas, envía aquí la foto o captura del comprobante. Confirmaremos la transferencia con el banco y te avisaremos por aquí.';
  return cuentas
    ? `${cuanto}\n\nPuedes transferir a una de estas cuentas:\n\n${cuentas}\n\n${comprobante}`
    : `${cuanto}. Te compartiremos por aquí la cuenta para transferir. ${comprobante}`;
}

function dinero(centavos: number): string {
  return FORMATO_MONEDA.format(fromCents(centavos));
}

/**
 * El canal web del servicio grupal: la solicitud nace de una conversacion del
 * chat y todo lo que Telegram le mandaba al cliente por su chat (mensajes del
 * jefe, peticion de ubicacion, cotizacion, saldo, rechazo del comprobante)
 * aqui queda en esa conversacion.
 *
 * Decision 6 de la Fase 5: el cliente no elige del catalogo; las modelos las
 * elige el jefe en `/jefe/grupos`. Por eso aqui no hay catalogo con botones.
 *
 * Solo depende de la base y del notificador (`ConversationNotifierModule`), no
 * de `ConversationsModule`: este importa `ServicesModule`, y Telegram los
 * importa a los dos, asi que depender de el cerraria un ciclo de modulos.
 */
@Injectable()
export class GrupoEnChatWebService {
  private readonly logger = new Logger(GrupoEnChatWebService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: ConversationNotifier,
    private readonly realtime: RealtimeEventsService,
  ) {}

  // ------------------------------------------------------- G1: nacimiento

  /**
   * La conversacion de la que va a nacer una solicitud, si le toca a quien
   * pregunta. Fuera de alcance responde 404, igual que una inexistente, como
   * la bandeja del equipo.
   */
  async conversacionParaGrupo(
    conversationId: string,
    actor: Actor,
  ): Promise<Conversation> {
    const conversation = await this.dataSource
      .getRepository(Conversation)
      .findOne({ where: { id: conversationId } });
    if (
      !conversation ||
      !(await modeloAlAlcance(
        this.dataSource.getRepository(Empleadas),
        actor,
        conversation.employeeId,
      ))
    ) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (conversation.status === 'cerrada') {
      throw new ConflictException(
        'Esta conversación está cerrada; el cliente tiene que abrir otra',
      );
    }
    return conversation;
  }

  /**
   * Toma la conversacion para quien organiza el grupo, como hace la bandeja:
   * a partir de aqui contesta una persona y la IA calla. No le quita la
   * conversacion a otra persona del equipo que ya la atiende; en ese caso se
   * deja como esta y el jefe del grupo escribe desde la solicitud igualmente.
   */
  async tomarControl(conversation: Conversation, actorId: string) {
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `UPDATE conversations
          SET mode = 'HUMAN_ACTIVE',
              human_owner_id = $2,
              human_taken_at = now(),
              updated_at = now()
        WHERE id = $1
          AND status <> 'cerrada'
          AND (mode = 'AI_ACTIVE' OR human_owner_id IS NULL)
        RETURNING id`,
      [conversation.id, actorId],
    );
    if (!filas[0]) return;

    if (conversation.mode === 'AI_ACTIVE') {
      await this.escribirSinFallar(
        conversation.id,
        TEXTOS_DEL_GRUPO_WEB.tomaDeControl,
      );
    }
    try {
      const modelo = await this.dataSource.getRepository(Empleadas).findOne({
        where: { id: conversation.employeeId },
        select: { id: true, jefeId: true, jefeSecundarioId: true },
      });
      this.realtime.emitToBosses(
        [modelo?.jefeId, modelo?.jefeSecundarioId, actorId],
        {
          type: CONVERSATION_MODE_CHANGED,
          data: {
            conversationId: conversation.id,
            mode: 'HUMAN_ACTIVE',
            humanOwnerId: actorId,
          },
        } satisfies ConversationModeChangedEvent,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo anunciar la toma de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }

  /**
   * Conversaciones que la IA entrego al equipo porque el cliente pidio varias
   * chicas y que aun no tienen solicitud grupal viva. Es la bandeja de entrada
   * de `/jefe/grupos` para el canal web: el turno no crea la solicitud solo.
   */
  async pedidosPendientes(actor: Actor): Promise<PedidoGrupalDelChat[]> {
    // Mismo alcance que la bandeja: `null` es el admin (todas las modelos).
    const modelos = await modelosAlAlcance(
      this.dataSource.getRepository(Empleadas),
      actor,
    );
    if (modelos && modelos.length === 0) return [];
    const filas: Array<{
      id: string;
      client_id: string;
      client_nombre: string;
      employee_id: string;
      nombre_artistico: string;
      last_message_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT c.id, c.client_id, c.employee_id, c.last_message_at,
              e.nombre_artistico,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''),
                       u.email, cl.nombre_telegram, 'Cliente') AS client_nombre
       FROM conversations c
       INNER JOIN empleadas e ON e.id = c.employee_id
       INNER JOIN clientes cl ON cl.id = c.client_id
       LEFT JOIN usuarios u ON u.id = cl.usuario_id
       WHERE ($1::uuid[] IS NULL OR c.employee_id = ANY($1::uuid[]))
         AND c.status <> 'cerrada'
         AND c.state->>'motivoDeEntrega' = 'servicio_grupal'
         AND NOT EXISTS (
           SELECT 1 FROM group_service_requests r
           WHERE r.conversation_id = c.id
             AND r.status = ANY($2::text[])
         )
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT $3`,
      [modelos, [...ESTADOS_DE_SOLICITUD_VIVA], MAX_PEDIDOS_PENDIENTES],
    );
    return filas.map((fila) => ({
      conversationId: fila.id,
      clientId: fila.client_id,
      clientNombre: fila.client_nombre,
      employeeId: fila.employee_id,
      nombreArtistico: fila.nombre_artistico,
      lastMessageAt: fila.last_message_at,
    }));
  }

  // ----------------------------------------------------- G2: conversacion

  async mensajes(request: GroupServiceRequest): Promise<MensajeDelGrupo[]> {
    if (!request.conversationId) return [];
    // Los ultimos, y despues en orden de lectura.
    const filas = await this.dataSource.getRepository(Message).find({
      where: { conversationId: request.conversationId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: MAX_MENSAJES_DEL_GRUPO,
    });
    return filas.reverse().map((m) => aMensajeDelGrupo(m, request));
  }

  /**
   * Lo que escribe el jefe desde la solicitud. El cliente lo ve como de la
   * modelo, igual que lo que se escribe desde la bandeja. Sin emojis, como
   * todo lo que sale por el chat web.
   */
  async escribirDelJefe(
    request: GroupServiceRequest,
    texto: string,
  ): Promise<MensajeDelGrupo> {
    const limpio = quitarEmojis(texto).trim();
    if (!limpio) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }
    const message = await this.notifier.escribir({
      conversationId: request.conversationId!,
      sender: 'jefe',
      texto: limpio,
    });
    return aMensajeDelGrupo(message, request);
  }

  async pedirUbicacion(request: GroupServiceRequest): Promise<void> {
    await this.notifier.escribir({
      conversationId: request.conversationId!,
      sender: 'sistema',
      texto: TEXTOS_DEL_GRUPO_WEB.pedirUbicacion,
    });
  }

  /** El ultimo pin que mando el cliente por el chat, si hay alguno. */
  async ultimaUbicacionDelCliente(
    conversationId: string,
  ): Promise<{ lat: number; lng: number; address: string | null } | null> {
    const filas: Array<{ attachment: MessageAttachment | null }> =
      await this.dataSource.query(
        `SELECT attachment
         FROM messages
         WHERE conversation_id = $1
           AND sender = 'cliente'
           AND attachment->>'type' = 'ubicacion'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [conversationId],
      );
    const adjunto = filas[0]?.attachment;
    const lat = Number(adjunto?.lat);
    const lng = Number(adjunto?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, address: adjunto?.address?.trim() || null };
  }

  // ------------------------------------------- G3 a G5: cotizacion y cobro

  /**
   * Engancha el servicio a la conversacion, como al aceptar un borrador: los
   * avisos del ciclo de vida y el comprobante lo buscan por `service_id`. No
   * pisa otro servicio que ya tuviera.
   */
  async enlazarServicio(
    manager: EntityManager,
    conversationId: string,
    serviceId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE conversations
          SET service_id = $2,
              status = CASE WHEN status = 'cerrada' THEN status
                            ELSE 'con_servicio'::conversations_status_enum END,
              updated_at = now()
        WHERE id = $1 AND (service_id IS NULL OR service_id = $2)`,
      [conversationId, serviceId],
    );
  }

  /** La cotizacion, con las cuentas si hay saldo por transferir. Nunca lanza. */
  async avisarCotizacion(
    request: Pick<GroupServiceRequest, 'conversationId'>,
    servicio: ServicioCotizable,
  ): Promise<void> {
    if (!request.conversationId) return;
    const cuentas = await this.cuentas();
    await this.escribirSinFallar(
      request.conversationId,
      textoDeCotizacion(servicio, cuentas),
    );
  }

  /**
   * Tras un pago o un cambio del grupo: el saldo que queda o, si ya no queda,
   * que el servicio quedo pagado. Solo en transferencia, que es lo que se
   * cobra por el chat. Nunca lanza.
   */
  async avisarSaldo(
    request: Pick<GroupServiceRequest, 'conversationId'>,
    servicio: Pick<Servicios, 'metodoPago' | 'pendingBalance'>,
    opciones: { pagoRegistrado?: boolean } = {},
  ): Promise<void> {
    if (!request.conversationId) return;
    if (servicio.metodoPago !== 'transferencia') return;
    const saldo = toCents(servicio.pendingBalance);
    if (saldo <= 0) {
      if (opciones.pagoRegistrado) {
        await this.escribirSinFallar(
          request.conversationId,
          TEXTOS_DEL_GRUPO_WEB.pagoCompleto,
        );
      }
      return;
    }
    await this.escribirSinFallar(
      request.conversationId,
      textoDeSaldo(saldo, await this.cuentas()),
    );
  }

  /**
   * El motivo lo escribe el jefe: pasa por `textoWebSeguro`, que le quita lo
   * que el cliente no debe leer, y si no queda nada se usa el generico.
   */
  async avisarComprobanteRechazado(
    request: Pick<GroupServiceRequest, 'conversationId'>,
    motivo: string | undefined,
  ): Promise<void> {
    if (!request.conversationId) return;
    const limpio = motivo ? textoWebSeguro(motivo).replace(/[.\s]+$/, '') : '';
    const texto = textoWebSeguro(
      TEXTOS_DEL_GRUPO_WEB.comprobanteRechazado(limpio || null),
      null,
      { respaldo: TEXTOS_DEL_GRUPO_WEB.comprobanteRechazadoGenerico },
    );
    await this.escribirSinFallar(
      request.conversationId,
      texto || TEXTOS_DEL_GRUPO_WEB.comprobanteRechazadoGenerico,
    );
  }

  private async cuentas(): Promise<string | null> {
    try {
      const activas = await this.dataSource
        .getRepository(AuthorizedBankAccounts)
        .find({ where: { activa: true }, order: { banco: 'ASC' } });
      return cuentasParaTransferir(activas);
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer las cuentas para transferir: ${describeError(error)}`,
      );
      return null;
    }
  }

  /**
   * Los avisos acompañan a una operacion ya hecha (el servicio se cotizo, el
   * pago se registro): un fallo aqui se registra y no la deshace.
   */
  private async escribirSinFallar(
    conversationId: string,
    texto: string,
  ): Promise<void> {
    try {
      await this.notifier.escribir({
        conversationId,
        sender: 'sistema',
        texto,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo dejar el aviso del grupo en la conversacion ${conversationId}: ${describeError(error)}`,
      );
    }
  }
}

function aMensajeDelGrupo(
  m: Pick<
    Message,
    'id' | 'sender' | 'body' | 'attachment' | 'createdAt' | 'conversationId'
  >,
  request: Pick<GroupServiceRequest, 'id' | 'clientId' | 'serviceId'>,
): MensajeDelGrupo {
  return {
    id: m.id,
    clienteId: request.clientId,
    servicioId: request.serviceId,
    groupRequestId: request.id,
    emisor: m.sender,
    mensaje: m.body,
    attachment: adjuntoDelGrupo(m.attachment ?? null),
    iaActiva: false,
    enviadoAt: m.createdAt,
  };
}

function adjuntoDelGrupo(
  adjunto: MessageAttachment | null,
): MensajeDelGrupo['attachment'] {
  if (!adjunto) return null;
  if (adjunto.type === 'ubicacion') {
    const latitude = Number(adjunto.lat);
    const longitude = Number(adjunto.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      type: 'location',
      latitude,
      longitude,
      ...(adjunto.address ? { address: adjunto.address } : {}),
    };
  }
  return adjunto.url ? { type: 'photo', url: adjunto.url } : null;
}
