import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  aperturasRecientes,
  capClientMessage,
  detectArrivalTimeQuestion,
  detectaClienteEnFuga,
  detectaInseguridad,
  detectProhibitedRequest,
  detectSonda,
  esUnaPromesaSinRespaldo,
  extrasYaCotizados,
  faltaCondicionDeHigiene,
  MAX_HISTORY_MESSAGES,
  pickArrivalTimeReply,
  pickDeflection,
  pickRecordatorioDeHigiene,
  PROHIBITED_REPLIES,
  quitarEmojis,
  shouldAdvanceBookingAfterMessage,
  stripControlMarkers,
  trimChatHistory,
} from '../ai/ai-guardrails';
import { getHireSystemPrompt } from '../ai/prompts/prompts';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { describeError } from '../common/errors/error-message';
import {
  APP_LOCALE,
  APP_TIME_ZONE,
  desdeHoraDelNegocio,
} from '../common/locale';
import { multiplyMoney, sumMoney } from '../common/money';
import { Empleadas } from '../employees/entities/employee.entity';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import { CustomerBookingSession } from './entities/customer-booking-session.entity';
import { TransportOperationsService } from '../transport-operations/transport-operations.service';
import { BookingAiService, HistorialDeReserva } from './booking-ai.service';
import {
  clearLoopFailures,
  DEFAULT_LOOP_BREAKER_MAX_FAILURES,
  detectGlobalBookingIntent,
  normalizeBookingText,
  registerLoopFailure,
  transitionBookingStatus,
} from './booking-lifecycle';
import {
  cuentasParaTransferir,
  montoEsperadoDelComprobante,
} from './booking-receipts';
import {
  duracionFijada,
  estadoInicial,
  normalizarEstado,
  reiniciarReserva,
  requisitoPendiente,
  ubicacionConfirmada,
  type BookingState,
  type PasoDeReserva,
} from './booking-state';
import {
  ConflictoDeVersionError,
  LimiteDiarioDeIaError,
} from './booking.errors';
import type {
  AvisoAlEquipo,
  BookingStateStore,
  ChatChannel,
  ConversationRef,
  InboundAttachment,
  InboundMessage,
  RemitenteDeMensaje,
} from './chat-channel';
import {
  detectGroupServiceIntent,
  detectOpenEndedDuration,
  extractHireDuration,
  extractHirePaymentMethod,
} from './extractores-de-reserva';
import {
  clienteHabloDeFechaOHora,
  duracionCorroborada,
  leerMarcaDeDatos,
  marcaDeGrupo,
  pagoDichoPorElCliente,
} from './marcas-de-control';
import { corregirRetrocesoDeDuracion, vestirRespuestaIa } from './respuesta-ia';
import {
  fueraDeCobertura,
  ubicacionMencionadaEn,
  ubicacionPorNombre,
} from './ubicaciones';

/**
 * Textos fijos del turno. Los del `sistema` hablan como la plataforma; los que
 * salen como la modelo conservan su tono. Ninguno lleva emojis: en la web no
 * se usan nunca.
 */
export const TEXTOS_DEL_TURNO = {
  limiteDiario:
    'Has alcanzado el límite de mensajes de hoy. La conversación continúa mañana.',
  falloIa:
    'En este momento no podemos responderte. Una persona del equipo revisará tu conversación en breve.',
  entregaAlEquipo:
    'Le pasamos tu conversación a una persona del equipo; te responderá por aquí en breve.',
  reservaEnRevision:
    'Tu solicitud ya está completa y en revisión. Te confirmaremos por aquí en cuanto quede coordinada.',
  cancelacionEnRevision:
    'Tu solicitud ya está en revisión. Avisamos al equipo de que quieres cancelarla; te confirmarán por aquí.',
  cancelada:
    'Listo, cancelamos esta solicitud. Cuando quieras, podemos empezar otra.',
  confirmarGrupo: '¿Quieres que el servicio incluya a dos o más chicas?',
  repetirGrupo: 'Solo para confirmar: ¿quieres a dos o más chicas?',
} as const;

const PROMPTS_DEL_BUCLE: Record<
  'primero' | 'segundo',
  Record<'duration' | 'location' | 'payment', string>
> = {
  primero: {
    duration:
      'No alcancé a entender cuántas horas quieres, mor. ¿Cuánto tiempo vamos a estar juntos?',
    location:
      'No alcancé a ubicar el lugar, mor. ¿Será uno de mis moteles o me compartes tu pin?',
    payment:
      'No alcancé a identificar el pago, mor. ¿Prefieres efectivo, tarjeta o transferencia?',
  },
  segundo: {
    duration:
      'Para seguir, escríbeme algo como “1 hora”, “2 hrs” o “indefinido”, porfa.',
    location:
      'Para seguir, escribe el nombre del motel o envíame el pin de ubicación.',
    payment: 'Para seguir, responde “efectivo”, “tarjeta” o “transferencia”.',
  },
};

const ETIQUETAS_DE_REQUISITO: Record<string, string> = {
  duration: 'la duración',
  location: 'la ubicación',
  payment: 'el método de pago',
  employee: 'la modelo',
};

/** Lo que el cliente escribio para el modelo cuando solo mando su pin. */
const TEXTO_DE_PIN = 'Te acabo de compartir mi ubicación.';

/**
 * "¿Eres humano?" casa con el router de "hablar con una persona". En la web es
 * una pregunta de identidad que tiene que contestar el modelo con la verdad,
 * no una peticion de traspaso.
 */
const PREGUNTA_SI_ES_HUMANO = /\beres (un |una )?(humano|humana|persona)\b/;

export interface ResultadoDeTurno {
  /** El turno se proceso y el cursor de mensajes atendidos avanzo. */
  atendido: boolean;
  estado: BookingState;
}

/** Contexto mutable de un turno: lo que se decide se va dejando en `estado`. */
interface Turno {
  ref: ConversationRef;
  inbound: InboundMessage;
  channel: ChatChannel;
  estado: BookingState;
}

type UbicacionActiva = Awaited<
  ReturnType<TransportOperationsService['activeLocations']>
>[number];

/**
 * Un turno de la conversacion de reserva, independiente del canal.
 *
 * Se apoya en las piezas puras de `booking/` y `ai/`, hablando con el cliente solo a
 * traves de `ChatChannel` y guardando el estado con `BookingStateStore`. El
 * orden es el mismo: barreras que no pasan por el modelo, router de
 * intenciones globales, extractores deterministas, modelo, filtros de salida y
 * marcas corroboradas, y cierre de la reserva en cuanto estan los datos.
 *
 * Regla de oro: la IA nunca ejecuta nada por si sola. Lo que dice el modelo
 * solo cambia la reserva si cuadra con lo que el cliente escribio de verdad y
 * con los datos del servidor.
 *
 * Fuera de este paso (y documentado en el plan): trio, fotos, modelo ocupada,
 * horarios ocupados y monto del pago mixto.
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  /** Fallos seguidos del proveedor antes de pasarle la conversacion al equipo. */
  static readonly MAX_FALLOS_IA_SEGUIDOS = 3;
  /** "Te aviso" sin respaldo que se toleran antes de pasarla al equipo. */
  static readonly MAX_APLAZAMIENTOS_SEGUIDOS = 2;

  constructor(
    private readonly bookingAi: BookingAiService,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(ExtrasCatalogo)
    private readonly extrasRepository: Repository<ExtrasCatalogo>,
    @InjectRepository(CustomerBookingSession)
    private readonly borradoresRepository: Repository<CustomerBookingSession>,
    private readonly transportOperations: TransportOperationsService,
    @InjectRepository(AuthorizedBankAccounts)
    private readonly cuentasRepository: Repository<AuthorizedBankAccounts>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Atiende un mensaje del cliente (o una rafaga ya agrupada por el canal).
   *
   * Si `inbound.channelMessageId` ya es el ultimo atendido no hace nada: un
   * turno reintentado no puede contestar dos veces. Nunca deja al cliente sin
   * respuesta por un error del turno; solo propaga los fallos al guardar el
   * estado, para que el canal no avance como si se hubiera atendido.
   */
  async handleClientMessage(
    ref: ConversationRef,
    inbound: InboundMessage,
    channel: ChatChannel,
    store: BookingStateStore<BookingState>,
  ): Promise<ResultadoDeTurno> {
    const cargado = await store.load(ref);
    const version = cargado?.version ?? 0;
    const estado = cargado ? normalizarEstado(cargado.state) : estadoInicial();

    if (
      inbound.channelMessageId &&
      estado.ultimoMensajeAtendidoId === inbound.channelMessageId
    ) {
      return { atendido: false, estado };
    }

    const turno: Turno = { ref, inbound, channel, estado };
    try {
      await this.ejecutarTurno(turno);
    } catch (error) {
      // Lo que falle fuera del tramo de la IA (consultas del prompt, el
      // borrador...) tampoco puede acabar en silencio.
      this.logger.error(
        `Error inesperado en el turno de la conversacion ${ref.conversationId ?? ref.clienteId}: ${describeError(error)}`,
      );
      await this.responderFalloIa(turno, error).catch((avisoError: unknown) =>
        this.logger.error(
          `Tampoco se pudo avisar del fallo al cliente ${ref.clienteId}: ${describeError(avisoError)}`,
        ),
      );
    }

    const final = turno.estado;
    if (inbound.channelMessageId) {
      final.ultimoMensajeAtendidoId = inbound.channelMessageId;
    }
    final.ultimaInteraccionAt = inbound.receivedAt.toISOString();
    const guardado = await this.guardarEstado(ref, store, final, version);
    return { atendido: true, estado: guardado };
  }

  private async ejecutarTurno(t: Turno): Promise<void> {
    // Con la conversacion en manos de una persona la IA no contesta: lo que
    // escriba el cliente ya lo ve el equipo en el panel.
    if (t.estado.entregadaAlEquipo) return;
    // Con el borrador ya convertido en servicio la IA tampoco contesta: seguir la reserva desde aqui
    // abriria otra encima de la aceptada. Del servicio se ocupa el equipo.
    if (t.estado.lifecycle === 'SERVICE_CREATED') return;

    const mensaje = capClientMessage(stripControlMarkers(t.inbound.text ?? ''));
    const pin = pinDe(t.inbound.attachments);
    if (!mensaje && !pin) return;
    // Un pin suelto es un dato de la reserva, no un mensaje que interpretar.
    if (!mensaje) t.estado.ultimaIntencion = 'PROVIDE_EXPECTED_DATA';

    // Barreras que no pasan por el modelo. Lo ilegal se corta antes de gastar
    // una llamada y se avisa al equipo; las sondas se contestan con un desvio.
    // La pregunta de identidad no es sonda en la web: llega al modelo.
    if (mensaje) {
      const prohibida = detectProhibitedRequest(mensaje);
      if (prohibida) {
        this.logger.warn(
          `Peticion prohibida (${prohibida}) del cliente ${t.ref.clienteId} en el chat web.`,
        );
        await this.decir(t, PROHIBITED_REPLIES[prohibida]);
        await this.notificar(t, {
          motivo: 'peticion_prohibida',
          detalle: `El cliente escribio algo bloqueado por la categoria "${prohibida}".`,
        });
        return;
      }
      if (detectSonda(mensaje)) {
        await this.desviar(t);
        return;
      }
      if (await this.enrutarIntencionGlobal(t, mensaje)) return;
    }

    if (t.estado.lifecycle === 'READY') {
      await this.decir(t, TEXTOS_DEL_TURNO.reservaEnRevision, 'sistema');
      return;
    }

    let entendido = false;
    if (pin) {
      if ((await this.aplicarPin(t, pin)) === 'fuera') return;
      entendido = true;
    }

    if (mensaje && detectArrivalTimeQuestion(mensaje)) {
      await this.responderTiempoDeLlegada(t);
      return;
    }

    if (mensaje && (await this.resolverServicioGrupal(t, mensaje))) return;

    if (mensaje && (await this.aplicarExtractores(t, mensaje))) {
      entendido = true;
    }
    if (entendido && t.estado.lifecycle === 'IDLE') {
      t.estado.lifecycle = transitionBookingStatus('IDLE', 'COLLECTING');
    }

    const empleada = await this.empleadasRepository.findOne({
      where: { id: t.ref.empleadaId },
    });
    if (!empleada) {
      throw new Error(`No existe la modelo ${t.ref.empleadaId}`);
    }

    // Con todo decidido no hace falta el modelo: el resumen de la reserva
    // dice lo mismo que diria el, pero con los datos.
    if (requisitoPendiente(t.estado, t.ref.empleadaId) === null) {
      await this.cerrarReserva(t, empleada);
      return;
    }

    await this.turnoConModelo(t, empleada, mensaje, entendido);
  }

  private async turnoConModelo(
    t: Turno,
    empleada: Empleadas,
    mensaje: string,
    entendidoAntes: boolean,
  ): Promise<void> {
    let entendido = entendidoAntes;
    const previo = t.channel.historialReciente
      ? await t.channel.historialReciente(t.ref, MAX_HISTORY_MESSAGES)
      : [];
    const historial: HistorialDeReserva = trimChatHistory([
      ...previo,
      { role: 'user', parts: [{ text: mensaje || TEXTO_DE_PIN }] },
    ]);
    // Del mas antiguo al mas reciente; incluye el mensaje de este turno.
    const delCliente = historial
      .filter((turno) => turno.role === 'user')
      .map((turno) => turno.parts[0]?.text ?? '');

    const [extras, activas, costoExterno, area] = await Promise.all([
      this.extrasRepository.find({
        where: { empleadaId: empleada.id, activo: true },
      }),
      this.transportOperations.activeLocations().catch(() => []),
      this.transportOperations.externalLocationFee().catch(() => 0),
      this.transportOperations.coverageArea().catch(() => null),
    ]);
    const nombresDeExtras = extras.map((extra) => extra.nombre);

    const systemPrompt = this.armarPrompt(t.estado, empleada, {
      historial,
      mensaje,
      entendido,
      extras,
      activas,
      costoExterno,
      ciudad: area?.ciudad ?? null,
    });

    await t.channel.showTyping(t.ref).catch(() => undefined);
    let respuesta: string;
    try {
      respuesta = await this.bookingAi.callModel(systemPrompt, historial, {
        clienteId: t.ref.clienteId,
      });
    } catch (error) {
      if (error instanceof LimiteDiarioDeIaError) {
        await this.decir(t, TEXTOS_DEL_TURNO.limiteDiario, 'sistema');
        return;
      }
      this.logger.error(
        `Fallo el modelo en la conversacion ${t.ref.conversationId ?? t.ref.clienteId}: ${describeError(error)}`,
      );
      await this.responderFalloIa(t, error);
      return;
    }
    t.estado.fallosIaSeguidos = 0;

    // Una marca de grupo es una sospecha del modelo, no una decision: el
    // detector determinista ya traslado arriba lo que era claramente grupal,
    // asi que aqui solo se pregunta.
    if (marcaDeGrupo(respuesta)) {
      t.estado.grupoPorConfirmar = true;
      await this.decir(t, TEXTOS_DEL_TURNO.confirmarGrupo);
      return;
    }

    const marca = leerMarcaDeDatos(respuesta);
    if (marca && this.aplicarMarcaDeDatos(t, marca, delCliente, activas)) {
      entendido = true;
    }
    if (entendido && t.estado.lifecycle === 'IDLE') {
      t.estado.lifecycle = transitionBookingStatus('IDLE', 'COLLECTING');
    }

    if (requisitoPendiente(t.estado, t.ref.empleadaId) === null) {
      await this.cerrarReserva(t, empleada);
      return;
    }

    let texto = this.vestir(t, respuesta);
    const corregido = corregirRetrocesoDeDuracion(texto, {
      duracionFijada: duracionFijada(t.estado),
      ubicacionConfirmada: ubicacionConfirmada(t.estado),
    });
    if (corregido !== null) {
      this.logger.warn(
        'La IA intento volver a pedir la duracion ya confirmada; se corrige al siguiente paso.',
      );
      texto = corregido;
    }
    if (faltaCondicionDeHigiene(texto, nombresDeExtras)) {
      const recordatorio = pickRecordatorioDeHigiene(
        t.estado.ultimoRecordatorioHigiene,
      );
      t.estado.ultimoRecordatorioHigiene = recordatorio;
      texto = `${texto} ${recordatorio}`.trim();
    }

    // El loop breaker va despues del parser y del modelo: si el mensaje no
    // aporto nada y no se entendio que pedia, se insiste en el dato que falta
    // en vez de dar una respuesta suelta. Solo cuando la reserva ya arranco,
    // para no cortar la charla de los primeros mensajes.
    const desconocida = t.estado.ultimaIntencion === 'UNKNOWN';
    if (desconocida && !entendido && t.estado.lifecycle === 'COLLECTING') {
      await this.romperBucle(t);
      return;
    }
    if (entendido || !desconocida) t.estado.loopBreaker = clearLoopFailures();

    // Una promesa que no mueve nada ("dejame checar y te aviso") no se repite
    // dos veces: la segunda contesta una persona.
    if (esUnaPromesaSinRespaldo(texto) && !hayAlgoEnMarcha(t.estado)) {
      t.estado.aplazamientosSeguidos += 1;
      if (
        t.estado.aplazamientosSeguidos >=
        BookingService.MAX_APLAZAMIENTOS_SEGUIDOS
      ) {
        t.estado.aplazamientosSeguidos = 0;
        await this.entregarAlEquipo(
          t,
          'conversacion_atascada',
          'La IA prometio consultar algo y volver, y no hay nada en marcha que vaya a cumplirlo.',
        );
        return;
      }
    } else if (!esUnaPromesaSinRespaldo(texto)) {
      t.estado.aplazamientosSeguidos = 0;
    }

    t.estado.paso = pasoPara(requisitoPendiente(t.estado, t.ref.empleadaId));
    await this.decir(t, texto);
  }

  /**
   * Intenciones que interrumpen cualquier paso. Devuelve si se hizo cargo del
   * turno; lo que puede traer datos de la reserva sigue por el flujo normal.
   */
  private async enrutarIntencionGlobal(
    t: Turno,
    mensaje: string,
  ): Promise<boolean> {
    const nombres = (
      await this.empleadasRepository.find({
        where: { catalogoActivo: true },
        select: { id: true, nombreArtistico: true },
      })
    ).map((empleada) => empleada.nombreArtistico);
    const ruta = detectGlobalBookingIntent(mensaje, { employeeNames: nombres });
    t.estado.ultimaIntencion = ruta.intent;

    switch (ruta.intent) {
      case 'REQUEST_HUMAN': {
        if (PREGUNTA_SI_ES_HUMANO.test(normalizeBookingText(mensaje))) {
          t.estado.ultimaIntencion = 'GENERAL_QUESTION';
          return false;
        }
        await this.entregarAlEquipo(
          t,
          'peticion_humana',
          'El cliente pidio hablar con una persona.',
        );
        return true;
      }
      case 'CANCEL_BOOKING': {
        if (t.estado.lifecycle === 'READY') {
          // La reserva ya la tiene el jefe y puede estar aceptandola en este
          // momento: cancelarla desde aqui competiria con el. Se le avisa.
          await this.notificar(t, {
            motivo: 'cancelacion_solicitada',
            detalle: 'El cliente pidio cancelar una solicitud ya en revision.',
            bookingSessionId: t.estado.bookingSessionId ?? null,
            mensajeAlCliente: TEXTOS_DEL_TURNO.cancelacionEnRevision,
          });
          return true;
        }
        t.estado = reiniciarReserva(t.estado);
        t.estado.ultimaIntencion = ruta.intent;
        await this.decir(t, TEXTOS_DEL_TURNO.cancelada, 'sistema');
        return true;
      }
      case 'START_NEW_BOOKING':
      case 'RESTART_BOOKING': {
        if (t.estado.lifecycle === 'READY') {
          await this.decir(t, TEXTOS_DEL_TURNO.reservaEnRevision, 'sistema');
          return true;
        }
        // Se empieza de cero y el mensaje sigue hacia el modelo, que es quien
        // retoma la conversacion.
        t.estado = reiniciarReserva(t.estado);
        t.estado.ultimaIntencion = ruta.intent;
        return false;
      }
      case 'CHANGE_EMPLOYEE': {
        // "otra" a secas tambien cae aqui ("quiero otra hora"): solo se
        // atiende cuando nombra a otra modelo del catalogo.
        const actual = await this.nombreDeLaModelo(t.ref.empleadaId);
        if (
          !ruta.employeeName ||
          ruta.confidence !== 'high' ||
          normalizeBookingText(ruta.employeeName) ===
            normalizeBookingText(actual ?? '')
        ) {
          return false;
        }
        await this.decir(
          t,
          `Para conversar con ${ruta.employeeName}, abre su perfil en el catálogo y escríbele desde ahí.`,
          'sistema',
        );
        return true;
      }
      case 'ASK_STATUS': {
        if (t.estado.lifecycle === 'READY') {
          await this.decir(t, TEXTOS_DEL_TURNO.reservaEnRevision, 'sistema');
          return true;
        }
        const falta = requisitoPendiente(t.estado, t.ref.empleadaId);
        await this.decir(
          t,
          falta
            ? `Tu solicitud sigue en curso; solo falta ${ETIQUETAS_DE_REQUISITO[falta] ?? 'un dato'}.`
            : 'Ya tenemos los datos principales de tu solicitud.',
          'sistema',
        );
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Un pin del cliente. La cobertura se decide solo con las coordenadas; sin
   * area configurada (o sin poder leerla) se acepta: un servicio fuera de zona que se cuele todavia pasa por el jefe.
   */
  private async aplicarPin(
    t: Turno,
    pin: { lat: number; lng: number; address?: string },
  ): Promise<'fuera' | 'aceptado'> {
    const area = await this.transportOperations
      .coverageArea()
      .catch((error: unknown) => {
        this.logger.error(
          `No se pudo leer el area de cobertura; se acepta el pin sin comprobarla: ${describeError(error)}`,
        );
        return null;
      });
    const rechazo = area ? fueraDeCobertura(area, pin.lat, pin.lng) : null;
    if (rechazo) {
      this.logger.warn(
        `Pin web fuera de cobertura (${rechazo.distanciaKm.toFixed(1)} km del centro de ${rechazo.ciudad}).`,
      );
      // No se guarda la ubicacion ni se cotiza: seria una oferta imposible.
      t.estado.fueraDeCobertura = true;
      t.estado.paso = undefined;
      await this.decir(
        t,
        `Ay, ahí sí no llego: yo atiendo solo en ${rechazo.ciudad} y sus alrededores, y esa ubicación me queda bien lejos. Si algún día andas por acá, me escribes y nos vemos.`,
      );
      return 'fuera';
    }

    const costo = await this.transportOperations
      .externalLocationFee()
      .catch(() => 0);
    const direccion = pin.address?.trim() || null;
    t.estado.ubicacion = {
      lat: pin.lat,
      lng: pin.lng,
      origen: 'pin',
      direccion,
    };
    t.estado.presetLocationId = undefined;
    t.estado.locationNameSnapshot = undefined;
    t.estado.locationAddressSnapshot = direccion ?? undefined;
    t.estado.customerTransportCharge = costo;
    t.estado.fueraDeCobertura = false;
    return 'aceptado';
  }

  /** Extractores deterministas sobre el mensaje. Devuelve si aporto datos. */
  private async aplicarExtractores(
    t: Turno,
    mensaje: string,
  ): Promise<boolean> {
    let entendido = false;
    if (detectOpenEndedDuration(mensaje)) {
      t.estado.duracionIndefinida = true;
      t.estado.duracionPactadaHoras = undefined;
      entendido = true;
    } else {
      const horas = extractHireDuration(mensaje);
      if (horas) {
        t.estado.duracionPactadaHoras = horas;
        t.estado.duracionIndefinida = false;
        entendido = true;
      }
    }
    const pago = extractHirePaymentMethod(mensaje);
    if (pago) {
      t.estado.metodoPago = pago;
      entendido = true;
    }

    // Un motel de la lista nombrado por el propio cliente.
    const activas = await this.transportOperations
      .activeLocations()
      .catch(() => [] as UbicacionActiva[]);
    const motel = ubicacionMencionadaEn(activas, [mensaje]);
    if (motel) {
      this.fijarMotel(t.estado, motel);
      entendido = true;
    }
    return entendido;
  }

  private fijarMotel(estado: BookingState, motel: UbicacionActiva): void {
    estado.ubicacion = {
      lat: Number(motel.latitude),
      lng: Number(motel.longitude),
      origen: 'motel',
      direccion: motel.address,
    };
    estado.presetLocationId = motel.id;
    estado.locationNameSnapshot = motel.name;
    estado.locationAddressSnapshot = motel.address;
    estado.customerTransportCharge = 0;
    estado.fueraDeCobertura = false;
  }

  /**
   * Aplica la marca `[DATA]` campo a campo, cada uno solo si lo respalda lo que
   * escribio el cliente. Devuelve si cambio algo.
   */
  private aplicarMarcaDeDatos(
    t: Turno,
    marca: NonNullable<ReturnType<typeof leerMarcaDeDatos>>,
    delCliente: string[],
    activas: UbicacionActiva[],
  ): boolean {
    let aplicada = false;

    if (marca.duracion !== null) {
      if (duracionCorroborada(delCliente, marca.duracion)) {
        if (marca.duracion === 'indefinida') {
          t.estado.duracionIndefinida = true;
          t.estado.duracionPactadaHoras = undefined;
        } else {
          t.estado.duracionPactadaHoras = marca.duracion;
          t.estado.duracionIndefinida = false;
        }
        aplicada = true;
        this.aplicarFechaDeLaMarca(t.estado, marca.fechaProgramada, delCliente);
      } else {
        this.logger.warn(
          `Se descarta la duracion de la marca (${marca.duracion}): el cliente ${t.ref.clienteId} no la dijo.`,
        );
      }
    }

    if (marca.pago) {
      const dicho = pagoDichoPorElCliente(delCliente);
      if (dicho === marca.pago) {
        t.estado.metodoPago = dicho;
        aplicada = true;
      } else {
        this.logger.warn(
          `Se descarta el pago de la marca (${marca.pago}): el cliente ${t.ref.clienteId} no lo eligio.`,
        );
      }
    }

    if (marca.ubicacionPreestablecida && !ubicacionConfirmada(t.estado)) {
      const nombrada = ubicacionPorNombre(
        activas,
        marca.ubicacionPreestablecida,
      );
      const dichaPorElCliente = ubicacionMencionadaEn(
        activas,
        [...delCliente].reverse(),
      );
      if (nombrada && dichaPorElCliente?.id === nombrada.id) {
        this.fijarMotel(t.estado, nombrada);
        aplicada = true;
      } else {
        this.logger.warn(
          `Se descarta la ubicacion de la marca: el cliente ${t.ref.clienteId} no nombro ese lugar.`,
        );
      }
    }
    return aplicada;
  }

  /**
   * La fecha viaja con la duracion porque el modelo reescribe la reserva entera
   * cuando la incluye: sin fecha es "ahora mismo". Una fecha solo se acepta si
   * el cliente hablo de un dia o una hora y si cae en el futuro.
   */
  private aplicarFechaDeLaMarca(
    estado: BookingState,
    fecha: string | null,
    delCliente: string[],
  ): void {
    if (!fecha) {
      estado.fechaProgramada = undefined;
      estado.tipoAgenda = 'inmediato';
      return;
    }
    if (!clienteHabloDeFechaOHora(delCliente)) {
      this.logger.warn(
        'Se descarta la fecha de la marca: el cliente no hablo de ningun dia ni hora.',
      );
      return;
    }
    // El modelo escribe la hora de Mexico sin zona; leerla como hora del
    // servidor la desplazaria seis horas.
    const interpretada = desdeHoraDelNegocio(fecha);
    if (interpretada && interpretada.getTime() > Date.now()) {
      estado.fechaProgramada = interpretada.toISOString();
      estado.tipoAgenda = 'programado';
    }
  }

  /** Servicio grupal: claro, se traslada; dudoso, se pregunta. */
  private async resolverServicioGrupal(
    t: Turno,
    mensaje: string,
  ): Promise<boolean> {
    const respuesta = mensaje.toLowerCase();
    if (t.estado.grupoPorConfirmar) {
      if (
        /^(s[ií]|claro|correcto|exacto|varias|más de una)\b/.test(respuesta)
      ) {
        t.estado.grupoPorConfirmar = false;
        await this.entregarAlEquipo(
          t,
          'servicio_grupal',
          'El cliente confirmo que quiere un servicio con varias chicas.',
        );
        return true;
      }
      if (/^(no|solo una|solamente una)\b/.test(respuesta)) {
        t.estado.grupoPorConfirmar = false;
        return false;
      }
      await this.decir(t, TEXTOS_DEL_TURNO.repetirGrupo);
      return true;
    }

    const intencion = detectGroupServiceIntent(mensaje);
    if (intencion === 'grupal') {
      await this.entregarAlEquipo(
        t,
        'servicio_grupal',
        'El cliente pidio un servicio con varias chicas.',
      );
      return true;
    }
    if (intencion === 'incierta') {
      t.estado.grupoPorConfirmar = true;
      await this.decir(t, TEXTOS_DEL_TURNO.confirmarGrupo);
      return true;
    }
    return false;
  }

  /**
   * "¿En cuanto llegas?" no tiene respuesta que el personaje pueda dar: el
   * transporte no se asigna hasta que el jefe acepta. Se contesta una vez con
   * una frase estable y a la segunda contesta una persona.
   */
  private async responderTiempoDeLlegada(t: Turno): Promise<void> {
    t.estado.aplazamientosSeguidos += 1;
    if (
      t.estado.aplazamientosSeguidos >=
      BookingService.MAX_APLAZAMIENTOS_SEGUIDOS
    ) {
      t.estado.aplazamientosSeguidos = 0;
      await this.entregarAlEquipo(
        t,
        'conversacion_atascada',
        'El cliente insiste en saber cuanto falta para que llegue la modelo.',
      );
      return;
    }
    const respuesta = pickArrivalTimeReply(t.estado.ultimoDesvio);
    t.estado.ultimoDesvio = respuesta;
    await this.decir(t, respuesta);
  }

  private async romperBucle(t: Turno): Promise<void> {
    const paso = t.estado.paso;
    const bucle = registerLoopFailure(
      t.estado.loopBreaker,
      paso,
      'UNKNOWN',
      DEFAULT_LOOP_BREAKER_MAX_FAILURES,
    );
    t.estado.loopBreaker = bucle.state;
    if (bucle.shouldEscalate) {
      t.estado.loopBreaker = clearLoopFailures();
      await this.entregarAlEquipo(
        t,
        'conversacion_atascada',
        'No fue posible interpretar varios mensajes seguidos durante la reserva.',
      );
      return;
    }
    const falta = requisitoPendiente(t.estado, t.ref.empleadaId);
    const clave =
      falta === 'location' || falta === 'payment' ? falta : 'duration';
    const tanda = bucle.state.failureCount === 1 ? 'primero' : 'segundo';
    t.estado.paso = pasoPara(falta);
    await this.decir(t, PROMPTS_DEL_BUCLE[tanda][clave]);
  }

  /**
   * Pasa la reserva al jefe en cuanto estan duracion, ubicacion y pago.
   *
   * Crea o actualiza el borrador en `customer_booking_sessions`, que es lo que
   * el panel del jefe sabe revisar y aceptar, y deja la conversacion en
   * revision. Con transferencia la reserva se cierra igual y queda esperando
   * el comprobante: el jefe tiene que enterarse aunque el cliente no vuelva a
   * escribir.
   */
  private async cerrarReserva(t: Turno, empleada: Empleadas): Promise<void> {
    const estado = t.estado;
    if (estado.lifecycle === 'IDLE') {
      estado.lifecycle = transitionBookingStatus('IDLE', 'COLLECTING');
    }
    estado.lifecycle = transitionBookingStatus(estado.lifecycle, 'READY');
    estado.esperandoComprobante =
      (estado.metodoPago === 'transferencia' ||
        estado.metodoPago === 'mixto') &&
      !estado.duracionIndefinida;
    estado.paso = estado.esperandoComprobante
      ? 'AWAITING_PAYMENT_RECEIPT'
      : undefined;
    estado.loopBreaker = clearLoopFailures();
    estado.aplazamientosSeguidos = 0;

    const borradorId = await this.guardarBorrador(t, empleada);
    estado.bookingSessionId = borradorId;
    t.ref.bookingSessionId = borradorId;

    await this.notificar(t, {
      motivo: 'reserva_lista',
      detalle: 'La reserva tiene duracion, ubicacion y metodo de pago.',
      bookingSessionId: borradorId,
      mensajeAlCliente: resumenDeReserva(estado, empleada),
    });

    // Al elegir transferencia los datos para pagar salen
    // en el mismo momento en que la reserva queda esperando el comprobante.
    if (estado.esperandoComprobante) {
      const cuentas = await this.cuentasParaPagar();
      await this.decir(t, datosParaPagar(estado, empleada, cuentas), 'sistema');
    }
  }

  /**
   * Las cuentas autorizadas activas; sin ninguna, el texto libre de
   * `BANK_ACCOUNT_DETAILS`, como hace `ServicesService.bankTransferDetails`.
   * Un fallo al leerlas no tumba el cierre: el cliente recibe igual el monto.
   */
  private async cuentasParaPagar(): Promise<string | null> {
    try {
      const cuentas = cuentasParaTransferir(
        await this.cuentasRepository.find({
          where: { activa: true },
          order: { banco: 'ASC', titular: 'ASC' },
        }),
      );
      if (cuentas) return cuentas;
    } catch (error) {
      this.logger.error(
        `No se pudieron leer las cuentas para transferir: ${describeError(error)}`,
      );
    }
    return (
      this.configService.get<string>('BANK_ACCOUNT_DETAILS')?.trim() || null
    );
  }

  /**
   * Escribe el borrador de la reserva, con
   * su control de version: si un jefe lo edito entre medias, gana su version.
   * Un borrador que ya paso a manos del jefe (aceptandose, con servicio) no se
   * toca.
   */
  private async guardarBorrador(
    t: Turno,
    empleada: Empleadas,
  ): Promise<string> {
    const estado = t.estado;
    const datos = {
      clientId: t.ref.clienteId,
      intendedEmployeeId: empleada.id,
      ownerBossId: empleada.jefeId ?? null,
      status: 'READY' as const,
      durationHours: estado.duracionPactadaHoras ?? null,
      openEndedDuration: Boolean(estado.duracionIndefinida),
      manualLocationConfirmed: false,
      placeType: estado.presetLocationId
        ? ('preset' as const)
        : ('external' as const),
      presetLocationId: estado.presetLocationId ?? null,
      locationName: estado.locationNameSnapshot ?? null,
      locationAddress: estado.locationAddressSnapshot ?? null,
      locationLat: estado.ubicacion?.lat ?? null,
      locationLng: estado.ubicacion?.lng ?? null,
      paymentMethod: estado.metodoPago ?? null,
      scheduleType:
        estado.tipoAgenda === 'programado'
          ? ('programado' as const)
          : ('inmediato' as const),
      scheduledAt: estado.fechaProgramada
        ? new Date(estado.fechaProgramada)
        : null,
      currentRequirement: estado.paso ?? null,
      mode: 'AI_ACTIVE' as const,
      lastInteractionAt: new Date(),
      updatedAt: new Date(),
    };
    const metadata = {
      canal: t.ref.channel,
      ...(t.ref.conversationId ? { conversationId: t.ref.conversationId } : {}),
      customerTransportCharge: estado.customerTransportCharge ?? 0,
      esperandoComprobante: Boolean(estado.esperandoComprobante),
    };

    const existente = estado.bookingSessionId
      ? await this.borradoresRepository.findOne({
          where: { id: estado.bookingSessionId },
        })
      : null;

    if (!existente) {
      const id = randomUUID();
      await this.borradoresRepository.save(
        this.borradoresRepository.create({
          id,
          ...datos,
          room: null,
          locationNotes: null,
          serviceId: null,
          version: 1,
          metadata,
          createdAt: new Date(),
        }),
      );
      return id;
    }

    if (!['COLLECTING', 'READY'].includes(existente.status)) {
      this.logger.warn(
        `El borrador ${existente.id} ya esta en ${existente.status}; la IA no lo modifica.`,
      );
      return existente.id;
    }
    const resultado = await this.borradoresRepository.update(
      { id: existente.id, version: existente.version },
      {
        ...datos,
        metadata: { ...existente.metadata, ...metadata },
        version: existente.version + 1,
      },
    );
    if (!resultado.affected) {
      this.logger.warn(
        `El borrador ${existente.id} cambio mientras la IA lo cerraba; se conserva la version del jefe.`,
      );
    }
    return existente.id;
  }

  private armarPrompt(
    estado: BookingState,
    empleada: Empleadas,
    contexto: {
      historial: HistorialDeReserva;
      mensaje: string;
      entendido: boolean;
      extras: ExtrasCatalogo[];
      activas: UbicacionActiva[];
      costoExterno: number;
      ciudad: string | null;
    },
  ): string {
    // Orden natural para no acosar al cliente: horas, ubicacion y pago.
    const datoQueFalta: 'horas' | 'ubicacion' | 'pago' | null = !duracionFijada(
      estado,
    )
      ? 'horas'
      : !ubicacionConfirmada(estado)
        ? 'ubicacion'
        : !estado.metodoPago
          ? 'pago'
          : null;

    // A una confesion o a una despedida no se les contesta con la pregunta
    // que falta: se le pregunta al turno siguiente.
    const clienteInseguro = detectaInseguridad(contexto.mensaje);
    const clienteSeEstaYendo = detectaClienteEnFuga(contexto.mensaje);
    const puedeAvanzar = shouldAdvanceBookingAfterMessage(
      contexto.mensaje,
      contexto.entendido,
    );
    const faltaPorCerrar =
      clienteInseguro || clienteSeEstaYendo || !puedeAvanzar
        ? null
        : datoQueFalta;

    const extras = contexto.extras.map((extra) => ({
      nombre: extra.nombre,
      precio: Number(extra.precio),
      modelosVinculadasNombres: [],
      speechPersonalizado: extra.speechPersonalizado ?? null,
    }));

    return getHireSystemPrompt({
      nombreArtistico: empleada.nombreArtistico,
      faltaPorCerrar,
      precioBaseHora: empleada.precioBaseHora,
      descripcion: empleada.descripcion,
      estiloHabla: empleada.estiloHabla,
      politicaBesos: empleada.politicaBesos,
      extras,
      // Trio, otras modelos y fotos no tienen todavia flujo en la web: si se
      // ofrecieran, el modelo prometeria algo que nadie va a cumplir.
      modelosDisponiblesTrio: [],
      otrasModelosDisponibles: [],
      trioConfirmado: null,
      trioEnConsulta: null,
      tieneFotosExclusivas: false,
      ubicacionesPreestablecidas: contexto.activas.map(
        (l) => `${l.name}${l.address ? ` (${l.address})` : ''}`,
      ),
      ciudadOperacion: contexto.ciudad,
      clienteFueraDeCobertura: Boolean(estado.fueraDeCobertura),
      clienteInseguro,
      clienteSeEstaYendo,
      aperturasRecientes: aperturasRecientes(contexto.historial),
      extrasYaCotizados: extrasYaCotizados(
        contexto.historial,
        extras.map((e) => e.nombre),
      ),
      costoTransporteExterno: contexto.costoExterno,
      duracionPactada: estado.duracionPactadaHoras,
      duracionIndefinida: estado.duracionIndefinida,
      ubicacionConfirmada: describirUbicacion(estado),
      comprobanteRecibido: false,
      servicioAceptado: false,
      metodoPago: estado.metodoPago,
      fechaHoraActual: new Date().toLocaleString(APP_LOCALE, {
        timeZone: APP_TIME_ZONE,
      }),
      horariosOcupados: [],
      fechaProgramadaPactada: estado.fechaProgramada
        ? new Date(estado.fechaProgramada).toLocaleString(APP_LOCALE, {
            timeZone: APP_TIME_ZONE,
          })
        : null,
    });
  }

  /** Filtros de salida de la web; ver `vestirRespuestaIa`. */
  private vestir(t: Turno, respuesta: string): string {
    const vestida = vestirRespuestaIa(respuesta, {
      ultimoDesvio: t.estado.ultimoDesvio,
    });
    if (vestida.quitoMostrador) {
      this.logger.warn(
        'La IA ofrecio ayuda como un mostrador; se quita esa frase del mensaje.',
      );
    }
    if (vestida.desvio) {
      t.estado.ultimoDesvio = vestida.desvio;
      this.logger.warn(
        vestida.sustituida
          ? 'La IA respondio con tono de asistente; se sustituye por un desvio.'
          : 'La respuesta de la IA quedo vacia tras los filtros; se sustituye por un desvio.',
      );
    }
    return vestida.texto;
  }

  private async desviar(t: Turno): Promise<void> {
    const desvio = pickDeflection(t.estado.ultimoDesvio);
    t.estado.ultimoDesvio = desvio;
    await this.decir(t, desvio);
  }

  /**
   * Fallo del proveedor o del turno. Uno suelto no apaga la IA: se avisa al
   * cliente, la conversacion pasa a revision para que la vea un jefe y el
   * siguiente mensaje lo vuelve a intentar. Varios seguidos la entregan.
   */
  private async responderFalloIa(t: Turno, error: unknown): Promise<void> {
    t.estado.fallosIaSeguidos += 1;
    const agotados =
      t.estado.fallosIaSeguidos >= BookingService.MAX_FALLOS_IA_SEGUIDOS;
    if (agotados) {
      t.estado.fallosIaSeguidos = 0;
      t.estado.entregadaAlEquipo = true;
      t.estado.motivoDeEntrega = 'fallo_ia';
    }
    await this.notificar(t, {
      motivo: 'fallo_ia',
      detalle: `La IA no pudo responder${agotados ? ' varias veces seguidas' : ''}: ${describeError(error)}`,
      bookingSessionId: t.estado.bookingSessionId ?? null,
      mensajeAlCliente: TEXTOS_DEL_TURNO.falloIa,
    });
  }

  private async entregarAlEquipo(
    t: Turno,
    motivo: AvisoAlEquipo['motivo'],
    detalle: string,
  ): Promise<void> {
    this.logger.warn(
      `Conversacion ${t.ref.conversationId ?? t.ref.clienteId} entregada al equipo: ${detalle}`,
    );
    t.estado.entregadaAlEquipo = true;
    t.estado.motivoDeEntrega = motivo;
    await this.notificar(t, {
      motivo,
      detalle,
      bookingSessionId: t.estado.bookingSessionId ?? null,
      mensajeAlCliente: TEXTOS_DEL_TURNO.entregaAlEquipo,
    });
  }

  /** Sin aviso propio en el canal, al menos el cliente lee el mensaje. */
  private async notificar(t: Turno, aviso: AvisoAlEquipo): Promise<void> {
    if (t.channel.notificarAlEquipo) {
      await t.channel.notificarAlEquipo(t.ref, aviso);
      return;
    }
    if (aviso.mensajeAlCliente) {
      await this.decir(t, aviso.mensajeAlCliente, 'sistema');
    }
  }

  private async decir(
    t: Turno,
    texto: string,
    remitente: RemitenteDeMensaje = 'ia',
  ): Promise<void> {
    const limpio = quitarEmojis(texto).trim();
    if (!limpio) return;
    await t.channel.sendText(t.ref, limpio, {
      sender: remitente,
      // Una pausa proporcional al texto, como quien escribe; el canal la acota.
      delayMs:
        remitente === 'ia' ? Math.min(2500, 400 + limpio.length * 15) : 0,
    });
  }

  private async nombreDeLaModelo(empleadaId: string): Promise<string | null> {
    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
      select: { id: true, nombreArtistico: true },
    });
    return empleada?.nombreArtistico ?? null;
  }

  /**
   * Guarda el estado con su version. Si otro escritor (un jefe) lo cambio
   * durante el turno, gana el: se recarga y solo se le añade el cursor de
   * mensajes atendidos, para que este turno no se repita y nadie reciba dos
   * respuestas al mismo mensaje.
   */
  private async guardarEstado(
    ref: ConversationRef,
    store: BookingStateStore<BookingState>,
    estado: BookingState,
    version: number,
  ): Promise<BookingState> {
    try {
      await store.save(ref, estado, version);
      return estado;
    } catch (error) {
      if (!(error instanceof ConflictoDeVersionError)) throw error;
      this.logger.warn(
        `El estado de la conversacion ${ref.conversationId ?? ref.clienteId} cambio durante el turno; se conserva el ajeno y solo se marca el mensaje como atendido.`,
      );
      const actual = await store.load(ref);
      if (!actual) throw error;
      const fusion = normalizarEstado(actual.state);
      fusion.ultimoMensajeAtendidoId = estado.ultimoMensajeAtendidoId;
      fusion.ultimaInteraccionAt = estado.ultimaInteraccionAt;
      await store.save(ref, fusion, actual.version);
      return fusion;
    }
  }
}

function pinDe(
  adjuntos: InboundAttachment[] | undefined,
): { lat: number; lng: number; address?: string } | null {
  const pin = (adjuntos ?? []).find(
    (adjunto) =>
      adjunto.type === 'location' &&
      Number.isFinite(adjunto.lat) &&
      Number.isFinite(adjunto.lng),
  );
  return pin
    ? { lat: pin.lat as number, lng: pin.lng as number, address: pin.address }
    : null;
}

function pasoPara(
  falta: ReturnType<typeof requisitoPendiente>,
): PasoDeReserva | undefined {
  if (falta === 'duration') return 'AWAITING_DURATION';
  if (falta === 'location') return 'AWAITING_LOCATION';
  if (falta === 'payment') return 'AWAITING_PAYMENT_METHOD';
  return undefined;
}

/** Con algo detras que cumpla la promesa, el "te aviso" es cierto. */
function hayAlgoEnMarcha(estado: BookingState): boolean {
  return Boolean(
    estado.esperandoComprobante ||
    estado.entregadaAlEquipo ||
    estado.lifecycle === 'READY',
  );
}

function describirUbicacion(estado: BookingState): string | null {
  if (!estado.ubicacion) return null;
  return (
    estado.locationNameSnapshot ||
    estado.ubicacion.direccion ||
    'Pin de ubicación enviado por el cliente'
  );
}

const FORMATO_MONEDA = new Intl.NumberFormat(APP_LOCALE, {
  style: 'currency',
  currency: 'MXN',
});

const NOMBRES_DE_PAGO: Record<string, string> = {
  efectivo: 'efectivo',
  tarjeta: 'tarjeta',
  transferencia: 'transferencia',
  mixto: 'mixto (transferencia y efectivo)',
};

/**
 * El mensaje del sistema que cierra la reserva: lo que el cliente pidio, con
 * el total que se le va a cobrar, para que no haya sorpresas en el motel. Los
 * importes pasan por `money.ts`.
 */
export function resumenDeReserva(
  estado: BookingState,
  empleada: Pick<Empleadas, 'nombreArtistico' | 'precioBaseHora'>,
): string {
  const partes: string[] = [];
  partes.push(
    estado.duracionIndefinida
      ? 'duración abierta (se cobra al terminar)'
      : `${estado.duracionPactadaHoras} ${estado.duracionPactadaHoras === 1 ? 'hora' : 'horas'}`,
  );
  partes.push(
    estado.locationNameSnapshot
      ? `en ${estado.locationNameSnapshot}`
      : 'en la ubicación que compartiste',
  );
  if (estado.tipoAgenda === 'programado' && estado.fechaProgramada) {
    partes.push(
      `para el ${new Date(estado.fechaProgramada).toLocaleString(APP_LOCALE, {
        timeZone: APP_TIME_ZONE,
        dateStyle: 'medium',
        timeStyle: 'short',
      })}`,
    );
  }
  partes.push(
    `pago en ${NOMBRES_DE_PAGO[estado.metodoPago ?? ''] ?? 'efectivo'}`,
  );

  const transporte = estado.customerTransportCharge ?? 0;
  let importe: string;
  if (estado.duracionIndefinida) {
    importe = `Tarifa: ${FORMATO_MONEDA.format(Number(empleada.precioBaseHora))} por hora`;
  } else {
    const total = sumMoney([
      multiplyMoney(empleada.precioBaseHora, estado.duracionPactadaHoras ?? 1),
      transporte,
    ]);
    importe = `Total estimado: ${FORMATO_MONEDA.format(total)}`;
  }
  if (transporte > 0) {
    importe += `, con ${FORMATO_MONEDA.format(transporte)} de traslado`;
  }

  const comprobante = estado.esperandoComprobante
    ? ' Queda pendiente el comprobante de la transferencia.'
    : '';
  return (
    `Solicitud lista para revisión con ${empleada.nombreArtistico}: ${partes.join(', ')}. ` +
    `${importe}.${comprobante} El equipo la revisará y te confirmará por aquí.`
  );
}

/**
 * Lo que el cliente necesita para pagar por transferencia: cuanto y a donde.
 * Sin cuentas que dar no se inventan; se le dice que el equipo se las pasara.
 * En pago mixto la parte por transferencia aun no se acuerda en la web, asi
 * que no se le pone una cifra que luego no cuadre.
 */
export function datosParaPagar(
  estado: BookingState,
  empleada: Pick<Empleadas, 'precioBaseHora'>,
  cuentas: string | null,
): string {
  const monto = montoEsperadoDelComprobante(estado, empleada.precioBaseHora);
  const destino = cuentas
    ? 'a una de estas cuentas'
    : 'a la cuenta que el equipo te compartirá por aquí';
  const cuanto =
    estado.metodoPago === 'mixto' && monto === null
      ? `Tu pago es mixto: la parte por transferencia va ${destino} y el resto se paga en efectivo.`
      : `Para confirmar tu reserva, transfiere ${monto === null ? 'el total acordado' : FORMATO_MONEDA.format(monto)} ${destino}.`;
  const comprobante =
    'Cuando lo tengas, envía aquí la foto o captura del comprobante.';
  return cuentas
    ? `${cuanto}\n\n${cuentas}\n\n${comprobante}`
    : `${cuanto} ${comprobante}`;
}
