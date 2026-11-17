import { multiplyMoney, roundMoney, sumMoney } from '../common/money';
import type { MetodoPagoReserva } from './extractores-de-reserva';

/**
 * Lo que la conversacion con el cliente va dejando decidido sobre su reserva.
 *
 * Es solo la parte que hace falta para cobrar y crear el servicio, con campos
 * opcionales porque se rellena mensaje a mensaje. La sesion de Telegram la
 * cumple tal cual; el estado de la reserva web tendra que cumplirla tambien.
 */
export interface BorradorDeReserva {
  duracionPactadaHoras?: number;
  duracionIndefinida?: boolean;
  metodoPago?: MetodoPagoReserva;
  mixedTransferAmount?: number;
  presetLocationId?: string;
  locationNameSnapshot?: string;
  locationAddressSnapshot?: string;
  customerTransportCharge?: number;
  trioStatus?: string;
  trioSelectedEmployeeName?: string;
  trioCombinedRatePerHour?: number;
  tipoAgenda?: 'inmediato' | 'programado';
  fechaProgramada?: string;
  bookingSessionId?: string;
}

/**
 * Todo lo que la conversacion con el cliente decidio y que hace falta para
 * crear su servicio.
 *
 * Se leia directo de la sesion, y eso funcionaba solo mientras quien cerraba
 * la reserva era el propio cliente. Cuando un comprobante pasa a revision
 * manual, la reserva la cierra el JEFE al pulsar "Aprobar" desde su grupo,
 * con su contexto y su sesion: alli no hay ubicacion preestablecida, ni cargo
 * de transporte, ni trio, ni cita programada, y el servicio nacia sin nada de
 * eso --sin cobrarle el transporte que se le habia cotizado y sin el
 * historial de la conversacion adjunto--.
 */
export interface DatosDeReserva {
  presetLocationId: string | null;
  locationNameSnapshot: string | null;
  locationAddressSnapshot: string | null;
  customerTransportCharge: number;
  duracionIndefinida: boolean;
  trioConfirmado: boolean;
  trioNombre: string | null;
  trioTarifaCombinada: number | null;
  tipoAgenda: 'inmediato' | 'programado';
  fechaProgramada: string | null;
  bookingSessionId: string | null;
}

/**
 * Lo que el borrador sabe de su propia reserva, con valores neutros donde no
 * sabe nada: sin borrador (el jefe que aprueba) no se inventa transporte ni
 * trio.
 */
export function datosDeReserva(borrador?: BorradorDeReserva): DatosDeReserva {
  return {
    presetLocationId: borrador?.presetLocationId ?? null,
    locationNameSnapshot: borrador?.locationNameSnapshot ?? null,
    locationAddressSnapshot: borrador?.locationAddressSnapshot ?? null,
    customerTransportCharge: Number(borrador?.customerTransportCharge ?? 0),
    duracionIndefinida: Boolean(borrador?.duracionIndefinida),
    trioConfirmado: borrador?.trioStatus === 'confirmed',
    trioNombre: borrador?.trioSelectedEmployeeName ?? null,
    trioTarifaCombinada: borrador?.trioCombinedRatePerHour ?? null,
    tipoAgenda:
      borrador?.tipoAgenda === 'programado' ? 'programado' : 'inmediato',
    fechaProgramada: borrador?.fechaProgramada ?? null,
    bookingSessionId: borrador?.bookingSessionId ?? null,
  };
}

/**
 * El monto que se le exige al comprobante de transferencia de una reserva.
 *
 * Es lo mismo que se le cotizo al cliente: horas por la tarifa --la combinada
 * si hay trio-- mas el cargo de transporte. Se calculaba a mano con la tarifa
 * base de la modelo y sin el transporte: en un servicio en trio el cliente
 * podia transferir la mitad de lo cotizado y el comprobante se aprobaba igual,
 * y con ubicacion externa se colaba sin el cargo de transporte que el propio
 * bot le acababa de sumar en el mensaje del precio.
 *
 * En pago mixto solo se espera la parte transferida: el resto y el transporte
 * se pagan en efectivo, y asi se le dijo al cliente.
 */
export function montoEsperadoDeTransferencia(
  borrador: BorradorDeReserva,
  precioBaseHora: number | string,
): number {
  if (borrador.metodoPago === 'mixto' && borrador.mixedTransferAmount) {
    return roundMoney(borrador.mixedTransferAmount);
  }
  const tarifaPorHora =
    borrador.trioCombinedRatePerHour ?? Number(precioBaseHora);
  const horas = borrador.duracionPactadaHoras ?? 1;
  return sumMoney([
    multiplyMoney(tarifaPorHora, horas),
    borrador.customerTransportCharge ?? 0,
  ]);
}
