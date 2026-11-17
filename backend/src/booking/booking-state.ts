import {
  BOOKING_STATUSES,
  GLOBAL_BOOKING_INTENTS,
  nextMissingRequirement,
  type BookingStatus,
  type GlobalBookingIntent,
  type LoopBreakerState,
} from './booking-lifecycle';
import type { BorradorDeReserva } from './datos-de-reserva';
import type { MetodoPagoReserva } from './extractores-de-reserva';

/**
 * Paso del formulario en el que esta la reserva. Solo los del flujo de
 * reserva: la `SessionData` de Telegram mezcla aqui calificaciones, reportes y
 * flujos del jefe que no pertenecen a una conversacion con el cliente.
 */
export type PasoDeReserva =
  | 'AWAITING_DURATION'
  | 'AWAITING_LOCATION'
  | 'AWAITING_PAYMENT_METHOD'
  | 'AWAITING_PAYMENT_RECEIPT';

/** Donde sera el servicio, ya aceptado (dentro de la zona que se atiende). */
export interface UbicacionDeReserva {
  lat: number;
  lng: number;
  /** `pin`: lo mando el cliente; `motel`: uno de los preestablecidos. */
  origen: 'pin' | 'motel';
  direccion?: string | null;
}

/**
 * Estado de una reserva que lleva la IA, independiente del canal.
 *
 * Es el subconjunto de la `SessionData` de Telegram que pertenece al flujo de
 * reserva, y nada mas: se guarda serializado (en la web, en
 * `conversations.state`) y cada campo que entre aqui se lee y se escribe en
 * cada turno. Por eso no lleva historial: el historial ya vive en los mensajes
 * de la conversacion, y duplicarlo aqui lo haria crecer sin limite.
 *
 * Extiende `BorradorDeReserva` para que `datosDeReserva` y
 * `montoEsperadoDeTransferencia` funcionen igual sobre la web que sobre
 * Telegram.
 */
export interface BookingState extends BorradorDeReserva {
  /** Version del formato, para poder migrar estados guardados. */
  esquema: 1;
  lifecycle: BookingStatus;
  paso?: PasoDeReserva;
  metodoPago?: MetodoPagoReserva;
  ubicacion?: UbicacionDeReserva;
  /**
   * El cliente mando un pin fuera de la zona y ya se le dijo. Sin esta marca la
   * IA le volvia a pedir la ubicacion al turno siguiente.
   */
  fueraDeCobertura?: boolean;
  /**
   * Pago por transferencia pendiente de comprobante. La reserva ya esta en
   * manos del jefe; la subida del comprobante llega en el paso 7.
   */
  esperandoComprobante?: boolean;
  /** Se le pregunto si quiere a mas de una chica y falta su respuesta. */
  grupoPorConfirmar?: boolean;
  /**
   * La conversacion se le paso a una persona (peticion del cliente, servicio
   * grupal, fallos repetidos de la IA, conversacion atascada). Mientras siga
   * puesta la IA no contesta; la retira quien devuelva el control.
   */
  entregadaAlEquipo?: boolean;
  motivoDeEntrega?: string;
  loopBreaker: LoopBreakerState;
  ultimaIntencion?: GlobalBookingIntent;
  /** Fallos seguidos del proveedor de IA; uno suelto no apaga a la IA. */
  fallosIaSeguidos: number;
  /** "Te aviso" seguidos sin nada detras que los vaya a cumplir. */
  aplazamientosSeguidos: number;
  ultimoDesvio?: string;
  ultimoRecordatorioHigiene?: string;
  /**
   * Ultimo mensaje del cliente ya atendido. Es el cursor que impide responder
   * dos veces al mismo mensaje cuando llegan seguidos o se reintenta un turno.
   */
  ultimoMensajeAtendidoId?: string;
  ultimaInteraccionAt?: string;
}

export function estadoInicial(): BookingState {
  return {
    esquema: 1,
    lifecycle: 'IDLE',
    loopBreaker: { failureCount: 0 },
    fallosIaSeguidos: 0,
    aplazamientosSeguidos: 0,
  };
}

/**
 * Lee un estado guardado sin fiarse de su forma.
 *
 * La columna nace como `{}` y la puede tocar otro proceso (un jefe en el
 * paso 8), asi que lo que llegue se mezcla sobre el estado inicial y lo que no
 * sea reconocible vuelve a su valor por defecto en vez de romper el turno.
 */
export function normalizarEstado(guardado: unknown): BookingState {
  const base = estadoInicial();
  if (!guardado || typeof guardado !== 'object' || Array.isArray(guardado)) {
    return base;
  }
  const crudo = guardado as Partial<BookingState>;
  const estado: BookingState = { ...base, ...crudo, esquema: 1 };
  if (!BOOKING_STATUSES.includes(estado.lifecycle)) {
    estado.lifecycle = base.lifecycle;
  }
  if (
    estado.ultimaIntencion &&
    !GLOBAL_BOOKING_INTENTS.includes(estado.ultimaIntencion)
  ) {
    estado.ultimaIntencion = undefined;
  }
  const loop = crudo.loopBreaker;
  estado.loopBreaker =
    loop && typeof loop === 'object' && Number.isFinite(loop.failureCount)
      ? loop
      : { failureCount: 0 };
  estado.fallosIaSeguidos = numeroONulo(crudo.fallosIaSeguidos) ?? 0;
  estado.aplazamientosSeguidos = numeroONulo(crudo.aplazamientosSeguidos) ?? 0;
  if (
    estado.ubicacion &&
    (!Number.isFinite(estado.ubicacion.lat) ||
      !Number.isFinite(estado.ubicacion.lng))
  ) {
    estado.ubicacion = undefined;
  }
  return estado;
}

function numeroONulo(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

export function ubicacionConfirmada(estado: BookingState): boolean {
  return Boolean(estado.ubicacion);
}

export function duracionFijada(estado: BookingState): boolean {
  return Boolean(estado.duracionPactadaHoras || estado.duracionIndefinida);
}

/** Lo siguiente que falta para poder pasarle la reserva al jefe. */
export function requisitoPendiente(
  estado: BookingState,
  empleadaId: string,
): ReturnType<typeof nextMissingRequirement> {
  return nextMissingRequirement({
    employeeId: empleadaId,
    durationHours: estado.duracionPactadaHoras,
    openEnded: estado.duracionIndefinida,
    locationConfirmed: ubicacionConfirmada(estado),
    paymentMethod: estado.metodoPago,
  });
}

/**
 * Olvida lo decidido sobre la reserva y conserva lo que pertenece a la
 * conversacion: el cursor de mensajes atendidos y los ultimos textos usados
 * (para no repetirlos). Se usa al cancelar o al empezar de nuevo.
 */
export function reiniciarReserva(estado: BookingState): BookingState {
  return {
    ...estadoInicial(),
    ultimoMensajeAtendidoId: estado.ultimoMensajeAtendidoId,
    ultimoDesvio: estado.ultimoDesvio,
    ultimoRecordatorioHigiene: estado.ultimoRecordatorioHigiene,
    ultimaInteraccionAt: estado.ultimaInteraccionAt,
  };
}
