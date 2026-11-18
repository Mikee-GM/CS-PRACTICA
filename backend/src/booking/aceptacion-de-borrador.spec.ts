import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CustomerBookingSession } from './entities/customer-booking-session.entity';
import {
  aceptarBorradorDeReserva,
  ubicacionDeBorradorValida,
} from './aceptacion-de-borrador';

function borrador(
  overrides: Partial<CustomerBookingSession> = {},
): CustomerBookingSession {
  return {
    id: 'borrador-1',
    clientId: 'cliente-1',
    intendedEmployeeId: 'empleada-1',
    ownerBossId: 'jefe-1',
    status: 'READY',
    mode: 'AI_ACTIVE',
    serviceId: null,
    version: 3,
    metadata: {},
    durationHours: 2,
    openEndedDuration: false,
    manualLocationConfirmed: false,
    placeType: 'external',
    presetLocationId: null,
    locationName: null,
    locationAddress: null,
    locationNotes: null,
    locationLat: 20.6,
    locationLng: -100.4,
    room: null,
    paymentMethod: 'transferencia',
    scheduleType: 'inmediato',
    scheduledAt: null,
    currentRequirement: null,
    ...overrides,
  } as CustomerBookingSession;
}

const EMPLEADA = {
  id: 'empleada-1',
  jefeId: 'jefe-1',
  jefeSecundarioId: null,
  precioBaseHora: 2500,
} as any;

describe('aceptarBorradorDeReserva', () => {
  let afectadas: number;
  let borradores: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let servicios: { findOne: jest.Mock };
  let reservas: { reserveNext: jest.Mock; ofrecerAEmpleada: jest.Mock };
  let enlazar: jest.Mock;

  const opciones = () => ({
    actorId: 'jefe-1',
    jefeId: 'jefe-1',
    clienteTelegramId: null,
    comprobantePendiente: true,
    enlazarConversacion: enlazar,
  });

  beforeEach(() => {
    afectadas = 1;
    borradores = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve({ affected: afectadas })),
      })),
      save: jest.fn((d: object) => Promise.resolve(d)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    servicios = { findOne: jest.fn().mockResolvedValue(null) };
    reservas = {
      reserveNext: jest.fn().mockResolvedValue({ id: 'servicio-1' }),
      ofrecerAEmpleada: jest.fn().mockResolvedValue(undefined),
    };
    enlazar = jest.fn().mockResolvedValue(undefined);
  });

  const deps = () => ({ borradores, servicios, reservas }) as any;

  it('crea el servicio sin chat de Telegram y enlaza la conversacion', async () => {
    const resultado = await aceptarBorradorDeReserva(
      deps(),
      borrador(),
      EMPLEADA,
      opciones(),
    );

    expect(reservas.reserveNext).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: 'cliente-1',
        bookingSessionId: 'borrador-1',
        clienteTelegramId: null,
        comprobantePendiente: true,
        iaActiva: false,
        jefeId: 'jefe-1',
      }),
    );
    expect(reservas.ofrecerAEmpleada).toHaveBeenCalledWith(
      'servicio-1',
      'jefe-1',
      'chofer',
      undefined,
      undefined,
    );
    expect(enlazar).toHaveBeenCalledWith('servicio-1');
    expect(resultado).toMatchObject({
      idempotent: false,
      service: { id: 'servicio-1' },
      draft: { serviceId: 'servicio-1', status: 'SERVICE_CREATED' },
    });
  });

  it('rechaza un borrador incompleto sin reclamarlo', async () => {
    await expect(
      aceptarBorradorDeReserva(
        deps(),
        borrador({ paymentMethod: null }),
        EMPLEADA,
        opciones(),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(borradores.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('si otro lo esta aceptando responde 409', async () => {
    afectadas = 0;
    borradores.findOne.mockResolvedValue(borrador({ status: 'ACCEPTING' }));

    await expect(
      aceptarBorradorDeReserva(deps(), borrador(), EMPLEADA, opciones()),
    ).rejects.toThrow(ConflictException);
    expect(reservas.reserveNext).not.toHaveBeenCalled();
  });

  it('si el otro ya termino devuelve su servicio como idempotente', async () => {
    afectadas = 0;
    borradores.findOne.mockResolvedValue(borrador({ serviceId: 'servicio-9' }));

    const resultado = await aceptarBorradorDeReserva(
      deps(),
      borrador(),
      EMPLEADA,
      opciones(),
    );
    expect(resultado.idempotent).toBe(true);
    expect(resultado.draft.serviceId).toBe('servicio-9');
  });

  it('si falla tras crear el servicio lo recupera en vez de duplicarlo', async () => {
    reservas.ofrecerAEmpleada.mockRejectedValue(new Error('fallo'));
    servicios.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'servicio-1' });

    const resultado = await aceptarBorradorDeReserva(
      deps(),
      borrador(),
      EMPLEADA,
      opciones(),
    );
    expect(resultado.idempotent).toBe(true);
    expect(enlazar).toHaveBeenCalledWith('servicio-1');
    expect(reservas.reserveNext).toHaveBeenCalledTimes(1);
  });

  it('si falla sin servicio devuelve el borrador a READY y propaga', async () => {
    reservas.reserveNext.mockRejectedValue(new ConflictException('ocupada'));

    await expect(
      aceptarBorradorDeReserva(deps(), borrador(), EMPLEADA, opciones()),
    ).rejects.toThrow('ocupada');
    expect(borradores.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'borrador-1' }),
      expect.objectContaining({ status: 'READY', version: 4 }),
    );
  });
});

describe('ubicacionDeBorradorValida', () => {
  it('el lugar escrito solo vale confirmado por una persona', () => {
    const sinPin = {
      locationLat: null,
      locationLng: null,
      locationName: 'Hotel',
      manualLocationConfirmed: true,
    };
    expect(ubicacionDeBorradorValida(borrador(sinPin))).toBe(false);
    expect(
      ubicacionDeBorradorValida(borrador({ ...sinPin, mode: 'HUMAN_ACTIVE' })),
    ).toBe(true);
  });
});
