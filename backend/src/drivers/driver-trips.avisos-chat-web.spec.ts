import { DriverTripsService } from './driver-trips.service';
import { Viajes } from '../trips/entities/trip.entity';

/**
 * La llegada con chofer propio y el cierre del regreso llegan tambien al chat
 * web del cliente.
 *
 * Solo salian si el cliente tenia `telegramChatId`, asi que quien reservo por
 * la web no se enteraba de que ella habia llegado ni de que el servicio habia
 * terminado. Telegram sigue igual; la web se intenta si la ficha tiene
 * `usuarioId`.
 */
const CHOFER = 'chofer-1';

const clienteWeb = { id: 'cli-web', usuarioId: 'usr-1', telegramChatId: null };
const clienteTelegram = {
  id: 'cli-tg',
  usuarioId: null,
  telegramChatId: '555',
};
const clienteAmbos = { id: 'cli-2', usuarioId: 'usr-2', telegramChatId: '556' };

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
      telegramThreadId: null,
      jefe: null,
      empleada: {
        nombreArtistico: 'Valentina',
        usuario: { telegramChatId: null },
        jefe: null,
      },
    },
  } as unknown as Viajes;
}

function montar(trip: Viajes) {
  const sendMessage = jest.fn(() => Promise.resolve({ message_id: 1 }));
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
    telegram: { sendMessage, deleteForumTopic: jest.fn() },
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
  return { service, sendMessage, notifyClient, generate };
}

describe('DriverTripsService: avisos al chat web del cliente', () => {
  describe('llegada con chofer propio', () => {
    it('el cliente web recibe la llegada sin emojis', async () => {
      const { service, sendMessage, notifyClient } = montar(
        viaje(clienteWeb, 'ida'),
      );

      await service.finalizarViaje('viaje-1', CHOFER);

      expect(sendMessage).not.toHaveBeenCalled();
      expect(notifyClient).toHaveBeenCalledWith({
        clienteId: 'cli-web',
        serviceId: 'servicio-1',
        employeeId: 'empleada-1',
        texto: 'Ya llegué',
      });
    });

    it('el cliente de Telegram la sigue recibiendo igual y no pasa por la web', async () => {
      const { service, sendMessage, notifyClient } = montar(
        viaje(clienteTelegram, 'ida'),
      );

      await service.finalizarViaje('viaje-1', CHOFER);

      expect(sendMessage).toHaveBeenCalledWith('555', 'Ya llegué \u{1F618}');
      expect(notifyClient).not.toHaveBeenCalled();
    });

    it('con los dos canales redacta una vez y avisa en cada uno', async () => {
      const { service, sendMessage, notifyClient, generate } = montar(
        viaje(clienteAmbos, 'ida'),
      );

      await service.finalizarViaje('viaje-1', CHOFER);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('556', 'Ya llegué \u{1F618}');
      expect(notifyClient).toHaveBeenCalledTimes(1);
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

    it('el cliente de Telegram recibe el mismo texto de siempre', async () => {
      const { service, sendMessage, notifyClient } = montar(
        viaje(clienteTelegram, 'regreso'),
      );

      await service.finalizarViaje('viaje-1', CHOFER);

      expect(sendMessage).toHaveBeenCalledWith(
        '555',
        'El servicio quedó completado: la empleada llegó a su destino.',
      );
      expect(notifyClient).not.toHaveBeenCalled();
    });
  });
});
