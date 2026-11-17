import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { AiProviderService } from '../ai/ai-provider.service';
import {
  claveSpeiDe,
  comprobanteEnCurso,
  enlazarComprobanteAServicio,
  estadoDeValidacion,
  guardarAnalisis,
  marcarErrorDeValidacion,
  montoEsperadoDelComprobante,
  registrarValidacion,
  validateReceiptAnalysis,
  type ResultadoDeComprobante,
} from '../booking/booking-receipts';
import { normalizarEstado } from '../booking/booking-state';
import type { ConversationRef } from '../booking/chat-channel';
import { Clientes } from '../clients/entities/client.entity';
import { describeError } from '../common/errors/error-message';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import { PaymentReceiptValidations } from '../services/entities/payment-receipt-validation.entity';
import { Servicios } from '../services/entities/service.entity';
import {
  UploadService,
  type UploadedFilePayload,
} from '../upload/upload.service';
import {
  EstadoDelComprobante,
  MESSAGE_CREATED,
  MessageCreatedEvent,
  RECEIPT_STATUS,
  ReceiptStatusEvent,
} from './conversation-events';
import {
  hayCobroPendiente,
  METODOS_CON_COMPROBANTE,
  SERVICIO_CERRADO,
  VENTANA_ANALISIS_MS,
} from './comprobante-pendiente';
import { aMensajeDelChat, type MensajeDelChat } from './conversations.service';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { WebChatChannel } from './web-chat-channel';

/**
 * Textos del sistema que acompañan al comprobante. Ninguno dice que el pago
 * este confirmado: lo confirma el equipo al comprobar el CEP.
 */
export const TEXTOS_DEL_COMPROBANTE = {
  recibido:
    'Recibimos tu comprobante. El equipo confirmará la transferencia con el banco y te avisará por aquí.',
  enRevision:
    'Recibimos tu comprobante y quedó en revisión con el equipo. Te confirmaremos por aquí en cuanto lo verifiquen.',
  error:
    'No pudimos revisar tu comprobante en este momento. El equipo ya está avisado; si quieres, envíalo de nuevo en unos minutos.',
  duplicado: 'Esta clave de rastreo ya se usó para confirmar otro pago.',
  sinMontoEsperado:
    'No hay un monto acordado con el que comparar el comprobante; requiere revisión del equipo.',
} as const;

/** Lo que se le pide al comprobante que llega por esta conversacion. */
export interface CobroPendiente {
  tipoCobro: 'reserva';
  /** `null` cuando no hay monto con el que comparar (mixto sin parte fijada). */
  montoEsperado: number | null;
  servicioId: string | null;
}

/** Lo que el analisis en segundo plano necesita del comprobante recibido. */
interface ComprobanteRecibido {
  conversation: Conversation;
  messageId: string;
  validation: PaymentReceiptValidations;
  imageUrl: string;
  cobro: CobroPendiente;
}

/**
 * Comprobantes de transferencia del chat web.
 *
 * La subida responde en cuanto la foto esta guardada y el mensaje creado; el
 * analisis de la IA corre despues, sin bloquear la peticion, y su resultado
 * llega al cliente como mensaje del sistema y evento `receipt_status`. Si el
 * proceso muere a medias la validacion queda en `PROCESANDO` y, pasada la
 * ventana de analisis, el cliente puede mandar otro: no hace falta ningun
 * trabajo periodico que la rescate.
 *
 * El registro y el analisis son los mismos que Telegram
 * (`booking/booking-receipts`); lo propio de la web es recibir el archivo por
 * multipart, el mensaje de la conversacion y los avisos por SSE.
 */
@Injectable()
export class ConversationReceiptsService {
  private readonly logger = new Logger(ConversationReceiptsService.name);

  /** Ver `VENTANA_ANALISIS_MS` en `comprobante-pendiente.ts`. */
  static readonly VENTANA_ANALISIS_MS = VENTANA_ANALISIS_MS;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messagesRepository: Repository<Message>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(PaymentReceiptValidations)
    private readonly validacionesRepository: Repository<PaymentReceiptValidations>,
    @InjectRepository(AuthorizedBankAccounts)
    private readonly cuentasRepository: Repository<AuthorizedBankAccounts>,
    private readonly uploadService: UploadService,
    private readonly aiProvider: AiProviderService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /**
   * Recibe el comprobante del cliente.
   *
   * Idempotente por `clientMessageId`: el reintento devuelve el mensaje ya
   * guardado sin volver a subir la imagen ni analizarla. `creado` le dice al
   * controlador si responder 201 o 200.
   */
  async subirComprobante(
    usuarioId: string,
    conversationId: string,
    archivo: UploadedFilePayload | undefined,
    dto: UploadReceiptDto,
  ): Promise<{ message: MensajeDelChat; creado: boolean }> {
    const clienteId = await this.resolveClienteId(usuarioId);
    const conversation = await this.conversationsRepository.findOne({
      where: { id: conversationId, clientId: clienteId },
    });
    if (!conversation) throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);

    const previo = await this.mensajePrevio(
      this.messagesRepository.manager,
      conversationId,
      dto.clientMessageId,
    );
    if (previo) return { message: aMensajeDelChat(previo), creado: false };

    if (!archivo?.buffer?.length) {
      throw new BadRequestException('Adjunta la imagen del comprobante');
    }
    // Todo lo que puede rechazar la peticion se comprueba antes de subir la
    // imagen: un comprobante que no se va a aceptar no debe quedar en R2.
    await this.exigirCobroPendiente(
      this.messagesRepository.manager,
      conversation,
    );

    // Se pasa el tipo vacio a proposito: asi `uploadEvidence` decide por los
    // bytes y no por lo que declaro el navegador.
    const subida = await this.uploadService.uploadEvidence({
      buffer: archivo.buffer,
      contentType: '',
      folder: 'transferencias',
      scopeId: conversationId,
    });

    const resultado = await this.dataSource.transaction(async (manager) => {
      // Mismo protocolo que los mensajes de texto: con la fila bloqueada, dos
      // pestañas que mandan a la vez no pueden registrar dos comprobantes.
      const bloqueada = await manager.findOne(Conversation, {
        where: { id: conversationId, clientId: clienteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!bloqueada) throw new NotFoundException(CONVERSACION_NO_ENCONTRADA);

      const repetido = await this.mensajePrevio(
        manager,
        conversationId,
        dto.clientMessageId,
      );
      if (repetido) {
        return {
          conversation: bloqueada,
          message: repetido,
          validation: null,
          cobro: null,
          creado: false,
        };
      }
      const cobroVigente = await this.exigirCobroPendiente(manager, bloqueada);

      const validation = await registrarValidacion(
        manager.getRepository(PaymentReceiptValidations),
        { imageUrl: subida.url, tipoCobro: cobroVigente.tipoCobro },
      );
      const message = await manager.save(
        manager.create(Message, {
          conversationId,
          sender: 'cliente',
          body: '',
          attachment: {
            type: 'comprobante',
            url: subida.url,
            sizeBytes: archivo.buffer.length,
          },
          receiptValidationId: validation.id,
          clientMessageId: dto.clientMessageId ?? null,
        }),
      );
      await manager.update(
        Conversation,
        { id: conversationId },
        { lastMessageAt: message.createdAt },
      );
      return {
        conversation: bloqueada,
        message,
        validation,
        cobro: cobroVigente,
        creado: true,
      };
    });

    if (!resultado.creado || !resultado.validation || !resultado.cobro) {
      // Otro intento con el mismo id gano la carrera tras la subida: esta
      // imagen queda huerfana en R2, pero no se duplica el comprobante.
      this.logger.warn(
        `Reintento concurrente del comprobante en la conversacion ${conversationId}; la imagen ${subida.key} no se usa.`,
      );
      return { message: aMensajeDelChat(resultado.message), creado: false };
    }

    await this.anunciar(resultado.conversation, {
      type: MESSAGE_CREATED,
      data: { conversationId, messageId: resultado.message.id },
    } satisfies MessageCreatedEvent);

    const recibido: ComprobanteRecibido = {
      conversation: resultado.conversation,
      messageId: resultado.message.id,
      validation: resultado.validation,
      imageUrl: subida.url,
      cobro: resultado.cobro,
    };
    void Promise.resolve()
      .then(() => this.analizar(recibido))
      .catch((error: unknown) =>
        this.logger.error(
          `Fallo el analisis del comprobante ${recibido.validation.id}: ${describeError(error)}`,
        ),
      );

    return { message: aMensajeDelChat(resultado.message), creado: true };
  }

  /**
   * Analiza el comprobante y le cuenta el resultado al cliente y al equipo.
   *
   * Nunca lanza por un fallo del analisis: lo deja en `ERROR_VALIDACION`, le
   * dice al cliente que puede reenviarlo y avisa al equipo.
   */
  async analizar(recibido: ComprobanteRecibido): Promise<EstadoDelComprobante> {
    const { conversation, cobro } = recibido;
    let validation = recibido.validation;
    let resultado: ResultadoDeComprobante | null = null;
    const empleada = await this.empleadasRepository.findOne({
      where: { id: conversation.employeeId },
      select: { id: true, jefeId: true, jefeSecundarioId: true },
    });

    try {
      // El JSON del analizador no tiene forma garantizada; lo interpretan las
      // funciones de `booking-receipts`, que no se fian de ningun campo.
      const analysis: unknown = await this.aiProvider.analyzeReceipt(
        recibido.imageUrl,
        cobro.montoEsperado ?? 0,
      );
      const cuentas = await this.cuentasRepository.find({
        where: { activa: true },
      });
      resultado = validateReceiptAnalysis(
        analysis,
        cobro.montoEsperado ?? 0,
        cuentas,
      );
      if (cobro.montoEsperado === null && resultado.valid) {
        // Sin monto acordado, que el analizador lo de por bueno no significa
        // nada: lo mira una persona.
        resultado = {
          valid: false,
          amount: resultado.amount,
          needsManualReview: true,
          reason: TEXTOS_DEL_COMPROBANTE.sinMontoEsperado,
        };
      }
      if (
        estadoDeValidacion(resultado) !== 'RECHAZADO' &&
        (await this.claveYaConfirmada(claveSpeiDe(analysis), validation.id))
      ) {
        // Una clave de rastreo que ya confirmo un pago no puede confirmar
        // otro (indice `uq_receipt_confirmed_spei_key`): es una captura
        // reutilizada, y se le pide otro comprobante.
        resultado = {
          valid: false,
          amount: resultado.amount,
          reason: TEXTOS_DEL_COMPROBANTE.duplicado,
        };
      }

      validation = await guardarAnalisis(
        this.validacionesRepository,
        validation,
        analysis,
        resultado,
        {
          jefeId: empleada?.jefeId ?? undefined,
          expectedAmount: cobro.montoEsperado ?? undefined,
          // Solo para rastrear de donde vino. No es el borrador de Telegram:
          // ese lo lee el boton "Aprobar" del bot, que aqui no existe.
          draftPayload: {
            canal: 'web',
            conversationId: conversation.id,
            bookingSessionId: conversation.bookingSessionId ?? null,
            servicioId: cobro.servicioId,
          },
        },
      );
    } catch (error) {
      await marcarErrorDeValidacion(
        this.validacionesRepository,
        validation,
        error,
      );
      this.logger.error(
        `No se pudo analizar el comprobante ${validation.id} de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
      resultado = null;
    }

    const estado = estadoDelComprobante(resultado);
    // Si el comprobante llego con la reserva en borrador, el jefe pudo
    // aceptarla mientras se analizaba: el servicio se mira de nuevo para que
    // la foto no quede suelta (al aceptar solo se enlaza lo que ya habia).
    const servicioId =
      cobro.servicioId ?? (await this.servicioDeLaConversacion(conversation));
    // El servicio que lo esperaba se entera en cuanto la foto no esta
    // descartada; asi el equipo puede confirmar el CEP desde el panel.
    if (servicioId && (estado === 'recibido' || estado === 'en_revision')) {
      await enlazarComprobanteAServicio(
        {
          servicios: this.serviciosRepository,
          validaciones: this.validacionesRepository,
        },
        this.realtime,
        servicioId,
        validation.id,
        (error) =>
          this.logger.error(
            `No se pudo enlazar el comprobante ${validation.id} al servicio ${servicioId}: ${describeError(error)}`,
          ),
      ).catch((error: unknown) =>
        this.logger.error(
          `No se pudo enlazar el comprobante ${validation.id}: ${describeError(error)}`,
        ),
      );
    }

    await this.contarResultado(recibido, estado, resultado);
    return estado;
  }

  private async servicioDeLaConversacion(
    conversation: Conversation,
  ): Promise<string | null> {
    try {
      const actual = await this.conversationsRepository.findOne({
        where: { id: conversation.id },
        select: { id: true, serviceId: true },
      });
      return actual?.serviceId ?? null;
    } catch (error) {
      this.logger.warn(
        `No se pudo releer el servicio de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
      return null;
    }
  }

  /**
   * Mensaje del sistema y eventos. En todo lo que no sea un rechazo, la
   * conversacion queda delante del equipo (sigue o pasa a `en_revision`): sea
   * para confirmar el CEP o para revisar la foto a mano.
   */
  private async contarResultado(
    recibido: ComprobanteRecibido,
    estado: EstadoDelComprobante,
    resultado: ResultadoDeComprobante | null,
  ): Promise<void> {
    const { conversation } = recibido;
    const ref: ConversationRef = {
      clienteId: conversation.clientId,
      empleadaId: conversation.employeeId,
      bookingSessionId: conversation.bookingSessionId ?? null,
      channel: 'web',
      conversationId: conversation.id,
    };
    const canal = new WebChatChannel(
      this.dataSource,
      this.empleadasRepository,
      this.realtime,
      { pausaMaximaMs: 0 },
    );

    try {
      if (estado === 'rechazado') {
        await canal.sendText(ref, textoDeRechazo(resultado?.reason), {
          sender: 'sistema',
        });
      } else {
        await canal.notificarAlEquipo(ref, {
          motivo: 'comprobante_recibido',
          detalle: `Comprobante ${recibido.validation.id} ${estado}: ${resultado?.reason ?? 'sin observaciones'}`,
          bookingSessionId: conversation.bookingSessionId ?? null,
          mensajeAlCliente:
            estado === 'recibido'
              ? TEXTOS_DEL_COMPROBANTE.recibido
              : estado === 'en_revision'
                ? TEXTOS_DEL_COMPROBANTE.enRevision
                : TEXTOS_DEL_COMPROBANTE.error,
        });
      }
    } catch (error) {
      this.logger.error(
        `No se pudo dejar el resultado del comprobante ${recibido.validation.id} en la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }

    await this.anunciar(conversation, {
      type: RECEIPT_STATUS,
      data: {
        conversationId: conversation.id,
        messageId: recibido.messageId,
        status: estado,
      },
    } satisfies ReceiptStatusEvent);
  }

  /**
   * El cobro que espera comprobante, o 409 si no hay ninguno.
   *
   * Vale la reserva que el turno de la IA dejo "esperando comprobante" y el
   * servicio por transferencia que sigue con la marca de comprobante
   * pendiente. Uno que ya esta en analisis o en revision tambien es 409: el
   * cliente no tiene que mandarlo dos veces.
   */
  private async exigirCobroPendiente(
    manager: EntityManager,
    conversation: Conversation,
  ): Promise<CobroPendiente> {
    if (conversation.status === 'cerrada') {
      throw new ConflictException(
        'Esta conversación está cerrada; abre una nueva para seguir',
      );
    }
    const cobro = await this.cobroPendiente(manager, conversation);
    if (!cobro) {
      throw new ConflictException(
        'No hay ningún pago por transferencia pendiente de comprobante en esta conversación',
      );
    }
    if (await this.hayComprobanteEnCurso(manager, conversation.id)) {
      throw new ConflictException(
        'Ya recibimos tu comprobante y está en revisión; no hace falta enviarlo otra vez',
      );
    }
    return cobro;
  }

  private async cobroPendiente(
    manager: EntityManager,
    conversation: Conversation,
  ): Promise<CobroPendiente | null> {
    const estado = normalizarEstado(conversation.state);
    const servicio = conversation.serviceId
      ? await manager.findOne(Servicios, {
          where: {
            id: conversation.serviceId,
            metodoPago: In([...METODOS_CON_COMPROBANTE]),
            comprobantePendiente: true,
            estado: Not(In([...SERVICIO_CERRADO])),
          },
          select: { id: true },
        })
      : null;
    if (!hayCobroPendiente(estado, Boolean(servicio))) return null;

    const empleada = await manager.findOne(Empleadas, {
      where: { id: conversation.employeeId },
      select: { id: true, precioBaseHora: true },
    });
    return {
      tipoCobro: 'reserva',
      montoEsperado: empleada
        ? montoEsperadoDelComprobante(estado, empleada.precioBaseHora)
        : null,
      servicioId: servicio?.id ?? null,
    };
  }

  /** El ultimo comprobante de la conversacion, si sigue en manos de alguien. */
  private async hayComprobanteEnCurso(
    manager: EntityManager,
    conversationId: string,
  ): Promise<boolean> {
    const filas: Array<{ estado: string | null; created_at: Date }> =
      await manager.query(
        `SELECT v.estado, v.created_at
         FROM messages m
         INNER JOIN payment_receipt_validations v
                 ON v.id = m.receipt_validation_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1`,
        [conversationId],
      );
    const ultimo = filas[0];
    return comprobanteEnCurso(
      ultimo
        ? { estado: ultimo.estado ?? undefined, createdAt: ultimo.created_at }
        : null,
      ConversationReceiptsService.VENTANA_ANALISIS_MS,
    );
  }

  /** Mismo criterio que el indice `uq_receipt_confirmed_spei_key`. */
  private async claveYaConfirmada(
    clave: string | undefined,
    validationId: string,
  ): Promise<boolean> {
    if (!clave) return false;
    const filas: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM payment_receipt_validations
       WHERE UPPER(id_spei) = UPPER($1)
         AND pago_confirmado_at IS NOT NULL
         AND id <> $2
       LIMIT 1`,
      [clave.trim(), validationId],
    );
    return filas.length > 0;
  }

  private mensajePrevio(
    manager: EntityManager,
    conversationId: string,
    clientMessageId: string | undefined,
  ): Promise<Message | null> {
    if (!clientMessageId) return Promise.resolve(null);
    return manager.findOne(Message, {
      where: { conversationId, clientMessageId },
    });
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

  /**
   * Al cliente y a los jefes de la modelo, igual que el resto de eventos del
   * chat. Si el aviso falla se registra: el panel lo vera al refrescar.
   */
  private async anunciar(
    conversation: Conversation,
    evento: { type: string; data: object },
  ): Promise<void> {
    try {
      this.realtime.emitToClient(conversation.clientId, evento);
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
        `No se pudo anunciar ${evento.type} de la conversacion ${conversation.id}: ${describeError(error)}`,
      );
    }
  }
}

const CONVERSACION_NO_ENCONTRADA = 'Conversación no encontrada';

function estadoDelComprobante(
  resultado: ResultadoDeComprobante | null,
): EstadoDelComprobante {
  if (!resultado) return 'error';
  const estado = estadoDeValidacion(resultado);
  if (estado === 'APROBADO') return 'recibido';
  return estado === 'PENDIENTE_REVISION' ? 'en_revision' : 'rechazado';
}

function textoDeRechazo(motivo: string | undefined): string {
  const limpio = (motivo ?? '').trim();
  const frase = limpio
    ? `${limpio}${/[.!?]$/.test(limpio) ? '' : '.'}`
    : 'El comprobante no parece válido.';
  return `No pudimos validar este comprobante. ${frase} Envía otro comprobante, por favor.`;
}
