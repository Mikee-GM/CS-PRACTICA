import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { estadoInicial } from '../booking/booking-state';
import { BookingService } from '../booking/booking.service';
import { ConflictoDeVersionError } from '../booking/booking.errors';
import type {
  ConversationRef,
  InboundAttachment,
  InboundMessage,
} from '../booking/chat-channel';
import { describeError } from '../common/errors/error-message';
import {
  ADVISORY_LOCKS,
  withAdvisoryLockPorClave,
} from '../common/scheduling/advisory-lock';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { ConversationTurnHandler } from './conversation-turn-handler';
import { Conversation } from './entities/conversation.entity';
import { MessageAttachment } from './entities/message.entity';
import { WebBookingStateStore } from './web-booking-state.store';
import { esperar, WebChatChannel } from './web-chat-channel';
import { NotificationsService } from '../notifications/notifications.service';

/** Mensajes del cliente que se atienden juntos, como mucho, en un turno. */
/**
 * Cuanto espera la IA desde el ultimo mensaje del cliente antes de empezar a
 * "escribir". Mas de un segundo y medio para que no parezca que contesta antes de
 * haber leido, y para agrupar a quien manda varios mensajes seguidos.
 */
const DEBOUNCE_POR_DEFECTO_MS = 4000;

const MAX_MENSAJES_POR_TURNO = 10;
/** Turnos seguidos que un mismo proceso encadena antes de soltar el lock. */
const MAX_RONDAS_POR_LOCK = 5;

type FilaPendiente = {
  id: string;
  body: string;
  attachment: MessageAttachment | null;
  created_at: Date;
};

/**
 * Turno de la IA del chat web: decide si contesta y, si contesta, que nunca
 * haya dos turnos a la vez sobre la misma conversacion.
 *
 * La exclusion es un advisory lock de Postgres por conversacion, asi que vale
 * entre replicas. El cursor de lo ya atendido vive en el estado de la reserva
 * (`ultimoMensajeAtendidoId`): quien tiene el lock atiende todo lo que este
 * despues del cursor, y quien no lo consigue reintenta hasta que no quede nada
 * pendiente. Asi un mensaje que llega con un turno en curso no se pierde ni se
 * contesta dos veces.
 */
@Injectable()
export class WebTurnHandler implements ConversationTurnHandler {
  private readonly logger = new Logger(WebTurnHandler.name);

  /** Espera para agrupar una rafaga de mensajes en un solo turno. */
  readonly debounceMs: number;
  /** Tope de la pausa de "escribiendo" antes de cada respuesta. */
  readonly pausaMaximaMs: number;
  /** Cada cuanto reintenta quien encontro el lock tomado. */
  intervaloReintentoMs = 500;
  /** Cuanto insiste antes de rendirse; un turno lento no pasa de esto. */
  esperaMaximaMs = 90_000;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    private readonly realtime: RealtimeEventsService,
    private readonly bookingService: BookingService,
    private readonly store: WebBookingStateStore,
    configService: ConfigService,
    // Opcional y al final: las pruebas arman este manejador a mano y sin el no
    // hay aviso push, pero el pase de control al equipo sigue ocurriendo.
    @Optional()
    private readonly notificaciones?: NotificationsService,
  ) {
    this.debounceMs = milisegundos(
      configService.get<number>('WEB_CHAT_DEBOUNCE_MS'),
      DEBOUNCE_POR_DEFECTO_MS,
    );
    this.pausaMaximaMs = milisegundos(
      configService.get<number>('WEB_CHAT_MAX_TYPING_DELAY_MS'),
      1500,
    );
  }

  // El mensaje concreto no hace falta: el turno atiende todo lo pendiente
  // tras el cursor, incluido este.
  async onClientMessage(conversation: Conversation): Promise<void> {
    if (this.debounceMs > 0) await esperar(this.debounceMs);
    await this.procesarPendientes(conversation.id);
  }

  /**
   * Atiende lo pendiente de una conversacion en exclusiva.
   *
   * Tras soltar el lock se vuelve a mirar: un mensaje que llego justo cuando
   * el turno terminaba encontro el lock tomado, y si nadie lo revisara se
   * quedaria sin respuesta. Quien no consigue el lock espera y reintenta por la
   * misma razon y porque dos conversaciones pueden compartir hash de lock.
   */
  async procesarPendientes(conversationId: string): Promise<void> {
    const limite = Date.now() + this.esperaMaximaMs;
    for (;;) {
      let ejecutado: boolean;
      try {
        ejecutado = await withAdvisoryLockPorClave(
          this.dataSource,
          ADVISORY_LOCKS.conversationTurn,
          conversationId,
          () => this.drenar(conversationId),
        );
      } catch (error) {
        // Un fallo aqui (guardar el estado, la base) no se reintenta en bucle:
        // el siguiente mensaje del cliente lo vuelve a intentar.
        this.logger.error(
          `Fallo el turno de la conversacion ${conversationId}: ${describeError(error)}`,
        );
        return;
      }
      if (!(await this.hayPendientes(conversationId))) return;
      if (Date.now() >= limite) {
        this.logger.warn(
          `La conversacion ${conversationId} sigue con mensajes pendientes tras ${this.esperaMaximaMs} ms; se atenderan con el siguiente mensaje.`,
        );
        return;
      }
      if (!ejecutado) await esperar(this.intervaloReintentoMs);
    }
  }

  /** Atiende rondas mientras sigan llegando mensajes; corre con el lock. */
  private async drenar(conversationId: string): Promise<void> {
    for (let ronda = 0; ronda < MAX_RONDAS_POR_LOCK; ronda += 1) {
      const conversation = await this.conversationsRepository.findOne({
        where: { id: conversationId },
      });
      if (!conversation || conversation.status === 'cerrada') return;

      const ref = refDe(conversation);
      const cargado = await this.store.load(ref);
      const pendientes = await this.mensajesPendientes(
        conversationId,
        cargado?.state.ultimoMensajeAtendidoId ?? null,
        MAX_MENSAJES_POR_TURNO,
      );
      if (pendientes.length === 0) return;

      if (conversation.mode === 'HUMAN_ACTIVE') {
        // Contesta una persona. Lo que escribio el cliente mientras tanto ya
        // lo atendio ella: se marca para que la IA no lo conteste al
        // devolverle el control.
        await this.marcarAtendidos(ref, cargado, pendientes);
        return;
      }

      const canal = new WebChatChannel(
        this.dataSource,
        this.empleadasRepository,
        this.realtime,
        {
          antesDeMensajeId: pendientes[0].id,
          pausaMaximaMs: this.pausaMaximaMs,
        },
      );
      // El asistente no ve fotos ni oye audios: contestarle un mensaje vacio
      // seria inventar. Se marcan atendidos y no se contesta nada: el equipo los
      // recibe como cualquier mensaje y responde como la modelo. Un aviso del
      // tipo "recibimos tu archivo" rompe la conversacion.
      const conMedia = pendientes.filter(llevaMedia);
      if (conMedia.length > 0) {
        await this.avisarAJefesDeMedia(
          conversation,
          conMedia[conMedia.length - 1].id,
        );
      }
      if (pendientes.every(esSoloMedia)) {
        // Pasa al equipo: la IA calla hasta que el jefe devuelva el control, y
        // la conversacion queda marcada para que la vea en su bandeja.
        await this.marcarAtendidos(ref, cargado, pendientes, true);
        try {
          await canal.notificarAlEquipo(ref, {
            motivo: 'media_del_cliente',
            detalle:
              'El cliente envio una foto o un audio que la IA no puede revisar.',
            bookingSessionId: cargado?.state.bookingSessionId ?? null,
          });
        } finally {
          canal.terminarTyping(ref);
        }
        continue;
      }
      try {
        await this.bookingService.handleClientMessage(
          ref,
          aMensajeEntrante(pendientes),
          canal,
          this.store,
        );
      } finally {
        canal.terminarTyping(ref);
      }
    }
  }

  private async hayPendientes(conversationId: string): Promise<boolean> {
    const filas: Array<{ status: string; cursor: string | null }> =
      await this.dataSource.query(
        `SELECT status, state->>'ultimoMensajeAtendidoId' AS cursor
         FROM conversations WHERE id = $1`,
        [conversationId],
      );
    const fila = filas[0];
    if (!fila || fila.status === 'cerrada') return false;
    const pendientes = await this.mensajesPendientes(
      conversationId,
      fila.cursor,
      1,
    );
    return pendientes.length > 0;
  }

  /**
   * Los mensajes del cliente posteriores al cursor, del mas antiguo al mas
   * reciente. Si hubiera mas de `limite`, se quedan los mas recientes: una
   * rafaga enorme no se le manda entera al modelo.
   */
  private async mensajesPendientes(
    conversationId: string,
    cursor: string | null,
    limite: number,
  ): Promise<FilaPendiente[]> {
    const filas: FilaPendiente[] = await this.dataSource.query(
      `SELECT m.id, m.body, m.attachment, m.created_at
       FROM messages m
       WHERE m.conversation_id = $1
         AND m.sender = 'cliente'
         AND ($2::uuid IS NULL OR (m.created_at, m.id) > (
               SELECT c.created_at, c.id FROM messages c
               WHERE c.id = $2::uuid AND c.conversation_id = $1))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      [conversationId, cursor, limite],
    );
    return filas.reverse();
  }

  /**
   * Aviso push a los jefes de la modelo de que el cliente mando una foto o un
   * audio. Sin texto del cliente ni de la modelo: se lee en la pantalla de
   * bloqueo. Nunca lanza: el pase de control no depende de que llegue el aviso.
   */
  private async avisarAJefesDeMedia(
    conversation: Conversation,
    ultimoMensajeId: string,
  ): Promise<void> {
    if (!this.notificaciones) return;
    try {
      const jefes = await this.jefesDeLaModelo(conversation.employeeId);
      await Promise.allSettled(
        jefes.map((jefeId) =>
          this.notificaciones!.notificar(jefeId, {
            titulo: 'Un cliente te escribio',
            cuerpo: 'Mando una foto o un audio. Toca para responder.',
            url: '/jefe',
            tag: `chat-${conversation.id}`,
            requireInteraction: true,
            relatedEntityId: conversation.id,
            dedupeKey: `chat-media:${ultimoMensajeId}:${jefeId}`,
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar a los jefes de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }

  /** Los jefes de la modelo; sin ninguno, todos los jefes y admins activos. */
  private async jefesDeLaModelo(empleadaId: string): Promise<string[]> {
    const modelo = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
      select: { id: true, jefeId: true, jefeSecundarioId: true },
    });
    const propios = [modelo?.jefeId, modelo?.jefeSecundarioId].filter(
      (id): id is string => Boolean(id),
    );
    if (propios.length > 0) return [...new Set(propios)];
    const filas: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM usuarios WHERE rol IN ('jefe', 'admin') AND activo = true`,
    );
    return filas.map((fila) => fila.id);
  }

  private async marcarAtendidos(
    ref: ConversationRef,
    cargado: Awaited<ReturnType<WebBookingStateStore['load']>>,
    pendientes: FilaPendiente[],
    entregarAlEquipo = false,
  ): Promise<void> {
    const estado = cargado?.state ?? estadoInicial();
    estado.ultimoMensajeAtendidoId = pendientes[pendientes.length - 1].id;
    if (entregarAlEquipo) {
      estado.entregadaAlEquipo = true;
      estado.motivoDeEntrega = 'media_del_cliente';
    }
    try {
      await this.store.save(ref, estado, cargado?.version ?? 0);
    } catch (error) {
      // Si un jefe guardo a la vez, la siguiente vuelta lo marca sobre su
      // version.
      if (!(error instanceof ConflictoDeVersionError)) throw error;
    }
  }
}

/** Un mensaje que es solo una foto o un audio, sin texto que acompañe. */
function esSoloMedia(fila: FilaPendiente): boolean {
  const tipo = fila.attachment?.type;
  return (tipo === 'foto' || tipo === 'audio') && !(fila.body ?? '').trim();
}

/** Una foto o un audio, con o sin texto: lo que la IA no puede revisar. */
function llevaMedia(fila: FilaPendiente): boolean {
  const tipo = fila.attachment?.type;
  return tipo === 'foto' || tipo === 'audio';
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
 * Una rafaga de mensajes como un solo mensaje entrante, con textos unidos por salto de linea y, de las ubicaciones,
 * la ultima.
 */
function aMensajeEntrante(pendientes: FilaPendiente[]): InboundMessage {
  const ultimo = pendientes[pendientes.length - 1];
  const ubicaciones: InboundAttachment[] = pendientes
    .map((fila) => fila.attachment)
    .filter(
      (adjunto): adjunto is MessageAttachment =>
        adjunto?.type === 'ubicacion' &&
        Number.isFinite(adjunto.lat) &&
        Number.isFinite(adjunto.lng),
    )
    .map((adjunto) => ({
      type: 'location' as const,
      lat: adjunto.lat,
      lng: adjunto.lng,
      address: adjunto.address,
    }));
  return {
    text: pendientes
      .map((fila) => (fila.body ?? '').trim())
      .filter(Boolean)
      .join('\n'),
    receivedAt: new Date(ultimo.created_at),
    attachments: ubicaciones.slice(-1),
    channelMessageId: ultimo.id,
  };
}

function milisegundos(valor: unknown, porDefecto: number): number {
  const numero = Number(valor);
  return valor !== undefined && valor !== '' && Number.isFinite(numero)
    ? Math.max(0, numero)
    : porDefecto;
}
