import { ServiceScheduleScheduler } from './service-schedule.scheduler';

/**
 * Lo que se protege aqui es que el recordatorio de cita no dependa de Telegram.
 *
 * El ciclo entero se apagaba sin token del bot, y la modelo y el jefe solo se
 * enteraban por Telegram. Ahora el personal recibe push y el cliente web su
 * chat; Telegram solo queda para el cliente que aun lo usa.
 */
describe('ServiceScheduleScheduler.checkUpcomingScheduledServices', () => {
  const serviciosRepository = { find: jest.fn(), save: jest.fn() };
  const bot = { telegram: { sendMessage: jest.fn() } };
  const aiMessageService = { generate: jest.fn() };
  const notifications = { notificar: jest.fn() };

  const scheduler = Object.create(
    ServiceScheduleScheduler.prototype,
  ) as ServiceScheduleScheduler;

  const cita = (overrides: Record<string, unknown> = {}) => ({
    id: 'srv-1',
    jefeId: 'jefe-1',
    empleadaId: 'emp-1',
    estado: 'agendado',
    tipoAgenda: 'programado',
    notificacionPreviaEnviada: false,
    fechaProgramada: new Date(Date.now() + 30 * 60_000),
    transporteAgendado: 'chofer',
    cliente: { telegramChatId: null, usuarioId: null },
    empleada: { usuarioId: 'user-emp', nombreArtistico: 'Modelo' },
    ...overrides,
  });

  const preparar = (telegramEnabled: boolean) =>
    Object.assign(scheduler, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      serviciosRepository,
      bot,
      aiMessageService,
      notifications,
      conversationNotifier: undefined,
      telegramEnabled,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.notificar.mockResolvedValue(1);
    serviciosRepository.save.mockImplementation((valor) =>
      Promise.resolve(valor),
    );
    aiMessageService.generate.mockResolvedValue('Ya casi es la hora.');
  });

  it('avisa por push a la modelo y al jefe aunque no haya bot', async () => {
    preparar(false);
    const servicio = cita();
    serviciosRepository.find.mockResolvedValue([servicio]);

    await scheduler.checkUpcomingScheduledServices();

    expect(servicio.notificacionPreviaEnviada).toBe(true);
    const destinos = notifications.notificar.mock.calls.map(([id]) => id);
    expect(destinos).toEqual(['user-emp', 'jefe-1']);
    const [, avisoEmpleada] = notifications.notificar.mock.calls[0];
    expect(avisoEmpleada.dedupeKey).toBe(
      'employee:appointment_reminder:srv-1:event',
    );
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('no manda nada al personal por Telegram', async () => {
    preparar(true);
    serviciosRepository.find.mockResolvedValue([
      cita({
        empleada: {
          usuarioId: 'user-emp',
          usuario: { telegramChatId: '555' },
        },
      }),
    ]);

    await scheduler.checkUpcomingScheduledServices();

    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('al cliente de Telegram le sigue llegando si el bot esta activo', async () => {
    preparar(true);
    serviciosRepository.find.mockResolvedValue([
      cita({ cliente: { telegramChatId: '777', usuarioId: null } }),
    ]);

    await scheduler.checkUpcomingScheduledServices();

    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.telegram.sendMessage.mock.calls[0][0]).toBe('777');
  });

  it('no recuerda una cita que todavia esta lejos', async () => {
    preparar(false);
    serviciosRepository.find.mockResolvedValue([
      cita({ fechaProgramada: new Date(Date.now() + 3 * 3_600_000) }),
    ]);

    await scheduler.checkUpcomingScheduledServices();

    expect(notifications.notificar).not.toHaveBeenCalled();
    expect(serviciosRepository.save).not.toHaveBeenCalled();
  });
});
