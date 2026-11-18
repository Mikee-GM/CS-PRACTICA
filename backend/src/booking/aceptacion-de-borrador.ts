import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import type { Empleadas } from '../employees/entities/employee.entity';
import type { Servicios } from '../services/entities/service.entity';
import type { ServicesService } from '../services/services.service';
import { CustomerBookingSession } from './entities/customer-booking-session.entity';

/**
 * Aceptar un borrador de reserva, independiente del canal.
 *
 * Acepta el borrador (`customer_booking_sessions`) con un protocolo unico. Lo
 * propio de cada llamador (que conversacion se enlaza al servicio, que avisos
 * salen) llega como opciones; aqui no se toca la conversacion web.
 *
 * Son funciones que reciben sus repositorios, como `booking-receipts`.
 */

/** Lo que se toca del borrador; cuadra con los dobles de los specs. */
export type RepositorioDeBorradores = Pick<
  Repository<CustomerBookingSession>,
  'findOne' | 'createQueryBuilder' | 'save' | 'update'
>;

export interface DependenciasDeAceptacion {
  borradores: RepositorioDeBorradores;
  servicios: Pick<Repository<Servicios>, 'findOne'>;
  reservas: Pick<ServicesService, 'reserveNext' | 'ofrecerAEmpleada'>;
}

export interface OpcionesDeAceptacion {
  /** Jefe o admin que acepta; abre la ventana de respuesta de la modelo. */
  actorId: string;
  /** Jefe al que queda asignado el servicio. */
  jefeId: string;
  /** Si el servicio nace esperando el comprobante de la transferencia. */
  comprobantePendiente: boolean;
  /**
   * Engancha la conversacion del canal al servicio. Se llama en todos los
   * caminos que acaban con servicio, tambien al recuperar uno que ya existia.
   */
  enlazarConversacion(serviceId: string): Promise<void>;
}

export interface ResultadoDeAceptacion {
  draft: CustomerBookingSession;
  service?: Servicios;
  idempotent: boolean;
}

function textoConContenido(valor: string | null | undefined): boolean {
  return Boolean(valor?.trim());
}

/**
 * El lugar escrito a mano solo vale si un jefe lo confirmo (borrador en
 * `HUMAN_ACTIVE`): la IA nunca da por buena una direccion sin pin.
 */
export function ubicacionDeBorradorValida(
  draft: Pick<
    CustomerBookingSession,
    | 'mode'
    | 'manualLocationConfirmed'
    | 'presetLocationId'
    | 'locationName'
    | 'locationAddress'
    | 'locationLat'
    | 'locationLng'
  >,
): boolean {
  const hasGps = draft.locationLat != null && draft.locationLng != null;
  const hasManualLocation =
    draft.mode === 'HUMAN_ACTIVE' &&
    draft.manualLocationConfirmed &&
    tieneLugarEscrito(draft);
  return hasGps || hasManualLocation;
}

export function tieneLugarEscrito(
  draft: Pick<
    CustomerBookingSession,
    'presetLocationId' | 'locationName' | 'locationAddress'
  >,
): boolean {
  return Boolean(
    draft.presetLocationId ||
    textoConContenido(draft.locationName) ||
    textoConContenido(draft.locationAddress),
  );
}

/** Modelo, duracion, pago y lugar: lo minimo para dar de alta el servicio. */
export function exigirBorradorCompleto(draft: CustomerBookingSession): void {
  if (
    !draft.intendedEmployeeId ||
    (!draft.durationHours && !draft.openEndedDuration) ||
    !draft.paymentMethod ||
    !ubicacionDeBorradorValida(draft)
  ) {
    throw new BadRequestException('El borrador todavía está incompleto');
  }
}

/**
 * Convierte el borrador en servicio y abre la ventana de respuesta de la
 * modelo.
 *
 * Quien llama ya comprobo que el actor puede aceptar y que el borrador no
 * tiene servicio. El borrador se reclama con un UPDATE condicionado por su
 * version (`ACCEPTING`): dos jefes que aceptan a la vez no crean dos
 * servicios, y el segundo recibe 409 o, si el primero ya termino, el mismo
 * servicio como idempotente. Si algo falla a medias se recupera el servicio
 * que haya quedado creado; si no hay ninguno, el borrador vuelve a `READY`.
 */
export async function aceptarBorradorDeReserva(
  deps: DependenciasDeAceptacion,
  draft: CustomerBookingSession,
  employee: Empleadas,
  opciones: OpcionesDeAceptacion,
): Promise<ResultadoDeAceptacion> {
  exigirBorradorCompleto(draft);
  const claimed = await deps.borradores
    .createQueryBuilder()
    .update(CustomerBookingSession)
    .set({
      status: 'ACCEPTING',
      version: draft.version + 1,
      updatedAt: new Date(),
    })
    .where('id = :id AND service_id IS NULL AND version = :version', {
      id: draft.id,
      version: draft.version,
    })
    .execute();
  if (!claimed.affected) {
    const current = await deps.borradores.findOne({ where: { id: draft.id } });
    if (!current) {
      throw new NotFoundException('Borrador de reserva no encontrado');
    }
    if (current.serviceId) return { draft: current, idempotent: true };
    throw new ConflictException(
      'La reserva está siendo aceptada por otra persona',
    );
  }

  const recuperar = async (
    service: Servicios,
  ): Promise<ResultadoDeAceptacion> => {
    const recovered = await deps.borradores.save({
      ...draft,
      serviceId: service.id,
      status: 'SERVICE_CREATED',
      version: draft.version + 2,
      updatedAt: new Date(),
    });
    await opciones.enlazarConversacion(service.id);
    return { draft: recovered, service, idempotent: true };
  };

  try {
    const preexistingService = await deps.servicios.findOne({
      where: { bookingSessionId: draft.id },
    });
    if (preexistingService) return await recuperar(preexistingService);

    const service = await deps.reservas.reserveNext({
      clienteId: draft.clientId,
      bookingSessionId: draft.id,
      empleadaId: employee.id,
      jefeId: opciones.jefeId,
      duracionPactadaHoras: draft.openEndedDuration ? 1 : draft.durationHours!,
      duracionIndefinida: draft.openEndedDuration,
      metodoPago: draft.paymentMethod!,
      ubicacionClienteLat: draft.locationLat,
      ubicacionClienteLng: draft.locationLng,
      precioBaseHoraPactado: Number(employee.precioBaseHora) || 1200,
      estado: 'pendiente',
      notas: draft.locationNotes || null,
      habitacion: draft.room,
      comprobantePendiente: opciones.comprobantePendiente,
      iaActiva: false,
      presetLocationId: draft.presetLocationId,
      locationNameSnapshot: draft.locationName,
      locationAddressSnapshot: draft.locationAddress,
      tipoAgenda: draft.scheduleType,
      fechaProgramada: draft.scheduledAt,
    });
    // La aceptacion del jefe abre la ventana de respuesta de la modelo. El
    // transporte queda vacio hasta que ella acepta.
    await deps.reservas.ofrecerAEmpleada(
      service.id,
      opciones.actorId,
      'chofer',
      typeof draft.metadata?.['bossNotes'] === 'string'
        ? draft.metadata['bossNotes']
        : undefined,
      draft.room ?? undefined,
    );
    const updated = await deps.borradores.save({
      ...draft,
      serviceId: service.id,
      status: 'SERVICE_CREATED',
      version: draft.version + 2,
      updatedAt: new Date(),
    });
    await opciones.enlazarConversacion(service.id);
    return { draft: updated, service, idempotent: false };
  } catch (error) {
    const existingService = await deps.servicios.findOne({
      where: { bookingSessionId: draft.id },
    });
    if (existingService) return recuperar(existingService);
    await deps.borradores.update(
      { id: draft.id, serviceId: IsNull() },
      { status: 'READY', version: draft.version + 1, updatedAt: new Date() },
    );
    throw error;
  }
}
