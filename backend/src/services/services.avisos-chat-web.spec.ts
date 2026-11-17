import { ServicesService } from './services.service';

/**
 * Los avisos del ciclo de vida del servicio llegan tambien al chat web.
 *
 * Solo salian si el cliente tenia `telegramChatId`, asi que quien reservo
 * desde la web se quedaba sin saber si su servicio se acepto, se rechazo o
 * cambio de hora. El camino de Telegram no cambia: estas pruebas comprueban
 * las dos cosas, que el cliente web recibe el aviso y que el de Telegram lo
 * sigue recibiendo igual.
 */
describe('ServicesService: avisos al chat web del cliente', () => {
  const bot = { telegram: { sendMessage: jest.fn() } };
  const conversationNotifier = { notifyClient: jest.fn() };
  const aiMessageService = {
    generate: jest.fn(),
    generateAgencyMessage: jest.fn(),
  };
  const notificationsService = { notificar: jest.fn() };
  const realtime = { emitToBoss: jest.fn() };
  const conversationsRepository = {
    create: jest.fn((datos: unknown) => datos),
    save: jest.fn(),
  };
  const usuariosRepository = { findOne: jest.fn() };
  const serviciosRepository = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn((valor: unknown) => valor),
    manager: { getRepository: jest.fn() },
  };

  const service = Object.create(ServicesService.prototype) as ServicesService;
  Object.assign(service, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    bot,
    conversationNotifier,
    aiMessageService,
    notificationsService,
    realtimeEventsService: realtime,
    conversationsRepository,
    usuariosRepository,
    serviciosRepository,
    choferesRepository: { findOne: jest.fn() },
    configService: { get: jest.fn() },
  });

  const clienteWeb = {
    id: 'cli-web',
    usuarioId: 'usr-cliente',
    telegramChatId: null,
  };
  const clienteTelegram = {
    id: 'cli-tg',
    usuarioId: null,
    telegramChatId: '555',
  };

  function servicio(cliente: Record<string, unknown>, extra = {}): any {
    return {
      id: 'svc-1',
      clienteId: cliente.id,
      cliente,
      clienteTelegramId: cliente.telegramChatId,
      empleadaId: 'emp-1',
      empleada: { nombreArtistico: 'Valentina', usuarioId: null },
      jefeId: 'jefe-1',
      fechaProgramada: new Date('2026-11-20T21:00:00Z'),
      ...extra,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    bot.telegram.sendMessage.mockResolvedValue({ message_id: 1 });
    conversationNotifier.notifyClient.mockResolvedValue(true);
    aiMessageService.generate.mockResolvedValue('Qué pena contigo \u{1F614}');
    aiMessageService.generateAgencyMessage.mockResolvedValue(
      'La nueva hora de llegada es 9:30.',
    );
    notificationsService.notificar.mockResolvedValue(1);
  });

  describe('reprogramacion', () => {
    it('un cliente sin Telegram recibe el cambio de hora en el chat web', async () => {
      await (service as any).avisarDeLaReprogramacion(
        servicio(clienteWeb),
        null,
        true,
      );

      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId: 'cli-web',
          serviceId: 'svc-1',
          employeeId: 'emp-1',
          texto: expect.stringContaining('nuestra cita con Valentina'),
        }),
      );
    });

    it('un cliente de Telegram lo sigue recibiendo igual y no pasa por la web', async () => {
      await (service as any).avisarDeLaReprogramacion(
        servicio(clienteTelegram),
        null,
        true,
      );

      expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining(
          'Amor, te confirmo el cambio de horario: nuestra cita con Valentina',
        ),
      );
      expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
    });

    it('si el jefe pide no avisar, tampoco avisa por la web', async () => {
      await (service as any).avisarDeLaReprogramacion(
        servicio(clienteWeb),
        null,
        false,
      );

      expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
    });
  });

  describe('cancelacion manual', () => {
    it('el cliente web recibe el mismo texto de la IA sin emojis', async () => {
      await (service as any).notifyServiceCancelled(
        servicio(clienteWeb),
        'pendiente',
        [],
      );

      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({ texto: 'Qué pena contigo' }),
      );
    });

    it('con los dos canales redacta una sola vez y avisa en cada uno', async () => {
      await (service as any).notifyServiceCancelled(
        servicio({ ...clienteTelegram, usuarioId: 'usr-cliente' }),
        'pendiente',
        [],
      );

      expect(aiMessageService.generate).toHaveBeenCalledTimes(1);
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        'Qué pena contigo \u{1F614}',
      );
      expect(conversationNotifier.notifyClient).toHaveBeenCalledTimes(1);
    });

    it('un fallo del chat web no rompe la cancelacion', async () => {
      conversationNotifier.notifyClient.mockRejectedValueOnce(
        new Error('base caida'),
      );

      await expect(
        (service as any).notifyServiceCancelled(
          servicio(clienteWeb),
          'pendiente',
          [],
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('rechazo del jefe', () => {
    const jefe = { id: 'jefe-1', rol: 'jefe' };

    beforeEach(() => {
      Object.assign(service, {
        transicionarEstado: jest.fn().mockResolvedValue(true),
        assertActorCanManageService: jest.fn(),
      });
      serviciosRepository.manager.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(jefe),
        update: jest.fn(),
      });
    });

    it('el cliente web se entera del rechazo por el chat', async () => {
      serviciosRepository.findOne
        .mockResolvedValueOnce(servicio(clienteWeb, { estado: 'pendiente' }))
        .mockResolvedValueOnce(null);

      await service.rechazar('svc-1', 'jefe-1');

      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId: 'cli-web',
          texto: 'Qué pena contigo',
        }),
      );
    });

    it('el cliente de Telegram lo sigue recibiendo por Telegram', async () => {
      serviciosRepository.findOne
        .mockResolvedValueOnce(
          servicio(clienteTelegram, { estado: 'pendiente' }),
        )
        .mockResolvedValueOnce(null);

      await service.rechazar('svc-1', 'jefe-1');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        'Qué pena contigo \u{1F614}',
      );
      expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
    });
  });

  describe('nueva hora de llegada por la cita anterior', () => {
    function encadenado(cliente: Record<string, unknown>) {
      serviciosRepository.findOneBy.mockResolvedValue({
        id: 'svc-0',
        horaInicioServicio: new Date('2026-11-20T18:00:00Z'),
        duracionPactadaHoras: 2,
      });
      serviciosRepository.findOne.mockResolvedValue(servicio(cliente));
    }

    it('el cliente web recibe el aviso de la agencia', async () => {
      encadenado(clienteWeb);

      await service.recalculateScheduledSuccessor('svc-0');

      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
      expect(conversationsRepository.save).not.toHaveBeenCalled();
      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          texto: 'La nueva hora de llegada es 9:30.',
        }),
      );
    });

    it('el cliente de Telegram lo recibe y queda en su historial como antes', async () => {
      encadenado(clienteTelegram);

      await service.recalculateScheduledSuccessor('svc-0');

      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        'La nueva hora de llegada es 9:30.',
      );
      expect(conversationsRepository.save).toHaveBeenCalledTimes(1);
      expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
    });
  });
});
