import { Injectable, Logger } from '@nestjs/common';
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

/** Mensajes del cliente que se atienden juntos, como mucho, en un turno. */
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
  ) {
    this.debounceMs = milisegundos(
      configService.get<number>('WEB_CHAT_DEBOUNCE_MS'),
      1500,
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

  private async marcarAtendidos(
    ref: ConversationRef,
    cargado: Awaited<ReturnType<WebBookingStateStore['load']>>,
    pendientes: FilaPendiente[],
  ): Promise<void> {
    const estado = cargado?.state ?? estadoInicial();
    estado.ultimoMensajeAtendidoId = pendientes[pendientes.length - 1].id;
    try {
      await this.store.save(ref, estado, cargado?.version ?? 0);
    } catch (error) {
      // Si un jefe guardo a la vez, la siguiente vuelta lo marca sobre su
      // version.
      if (!(error instanceof ConflictoDeVersionError)) throw error;
    }
  }
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
 * Una rafaga de mensajes como un solo mensaje entrante, igual que hacia el
 * buffer de Telegram: textos unidos por salto de linea y, de las ubicaciones,
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
