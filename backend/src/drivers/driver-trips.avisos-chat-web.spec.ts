import { DriverTripsService } from './driver-trips.service';
import { Viajes } from '../trips/entities/trip.entity';

/**
 * La llegada con chofer propio y el cierre del regreso llegan tambien al chat
 * web del cliente.
 *
 * El aviso se intenta solo si la ficha del cliente tiene `usuarioId`; sin
 * cuenta web no sale nada y el viaje se cierra igual.
 */
const CHOFER = 'chofer-1';

const clienteWeb = { id: 'cli-web', usuarioId: 'usr-1' };
const clienteSinCuenta = { id: 'cli-sin', usuarioId: null };

function viaje(
  cliente: Record<string, unknown>,
  tipo: 'ida' | 'regreso',
): Viajes {
  return {
    id: 'viaje-1',
    servicioId: 'servicio-1',
    choferId: CHOFER,
    estado: 'en_curso',
    tipo,
    servicio: {
      id: 'servicio-1',
      clienteId: cliente.id,
      cliente,
      empleadaId: 'empleada-1',
      jefeId: 'jefe-1',
      cobroFinalPendiente: false,
      jefe: null,
      empleada: {
        nombreArtistico: 'Valentina',
        usuario: {},
        jefe: null,
      },
    },
  } as unknown as Viajes;
}

function montar(trip: Viajes) {
  const notifyClient = jest.fn(() => Promise.resolve(true));
  const generate = jest.fn(() => Promise.resolve('Ya llegué \u{1F618}'));
  const dependencias: Record<string, unknown> = {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    viajes: {
      findOne: jest.fn(() => Promise.resolve(trip)),
      find: jest.fn(() => Promise.resolve([])),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    },
    choferes: {
      findOne: jest.fn(() => Promise.resolve({ id: CHOFER, nombre: 'Luis' })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    },
    servicios: { update: jest.fn(() => Promise.resolve({ affected: 1 })) },
    realtime: {
      emitToBoss: jest.fn(),
      emitToClient: jest.fn(),
      emitToDriver: jest.fn(),
      emitToEmployee: jest.fn(),
    },
    settlements: { syncDriverSettlement: jest.fn(() => Promise.resolve()) },
    notifications: { notificar: jest.fn(() => Promise.resolve(0)) },
    aiMessages: { generate },
    servicesService: {
      sendFinalReceiptAndAward: jest.fn(() => Promise.resolve()),
      markEmployeeTripProgress: jest.fn(() => Promise.resolve()),
    },
    conversationNotifier: { notifyClient },
  };
  const service = Object.create(
    DriverTripsService.prototype,
  ) as DriverTripsService;
  Object.assign(service, dependencias);
  return { service, notifyClient, generate };
}

describe('DriverTripsService: avisos al chat web del cliente', () => {
  describe('llegada con chofer propio', () => {
    it('el cliente web recibe la llegada sin emojis', async () => {
      const { service, notifyClient, generate } = montar(
        viaje(clienteWeb, 'ida'),
      );

      await service.finalizarViaje('viaje-1', CHOFER);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(notifyClient).toHaveBeenCalledWith({
        clienteId: 'cli-web',
        serviceId: 'servicio-1',
        employeeId: 'empleada-1',
        texto: 'Ya llegué',
      });
    });

    it('sin cuenta web no se avisa a nadie y el viaje termina igual', async () => {
      const { service, notifyClient } = montar(viaje(clienteSinCuenta, 'ida'));

      await expect(
        service.finalizarViaje('viaje-1', CHOFER),
      ).resolves.toMatchObject({ estado: 'finalizado' });
      expect(notifyClient).not.toHaveBeenCalled();
    });

    it('un fallo del chat web no deshace el fin del viaje', async () => {
      const { service, notifyClient } = montar(viaje(clienteWeb, 'ida'));
      notifyClient.mockRejectedValueOnce(new Error('base caida'));

      await expect(
        service.finalizarViaje('viaje-1', CHOFER),
      ).resolves.toMatchObject({ estado: 'finalizado' });
    });
  });

  describe('cierre del regreso', () => {
    it('el cliente web recibe el cierre nombrandola a ella', async () => {
      const { service, notifyClient } = montar(viaje(clienteWeb, 'regreso'));

      await service.finalizarViaje('viaje-1', CHOFER);

      expect(notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId: 'cli-web',
          serviceId: 'servicio-1',
          texto: 'El servicio quedó completado: Valentina llegó a su destino.',
        }),
      );
    });
  });
});
