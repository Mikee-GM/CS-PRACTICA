import { ServiceScheduleScheduler } from './service-schedule.scheduler';

/**
 * El recordatorio de cita llega por push a la modelo y al jefe, y por el chat
 * web al cliente que tiene cuenta.
 */
describe('ServiceScheduleScheduler.checkUpcomingScheduledServices', () => {
  const serviciosRepository = { find: jest.fn(), save: jest.fn() };
  const conversationNotifier = { notifyClient: jest.fn() };
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
    cliente: { usuarioId: null },
    clienteId: 'cli-1',
    empleada: { usuarioId: 'user-emp', nombreArtistico: 'Modelo' },
    ...overrides,
  });

  const preparar = (conCanalWeb = false) =>
    Object.assign(scheduler, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      serviciosRepository,
      aiMessageService,
      notifications,
      conversationNotifier: conCanalWeb ? conversationNotifier : undefined,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.notificar.mockResolvedValue(1);
    serviciosRepository.save.mockImplementation((valor) =>
      Promise.resolve(valor),
    );
    aiMessageService.generate.mockResolvedValue('Ya casi es la hora.');
    conversationNotifier.notifyClient.mockResolvedValue(true);
  });

  it('avisa por push a la modelo y al jefe aunque no haya canal web', async () => {
    preparar();
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
    expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
  });

  it('al cliente con cuenta web le llega el recordatorio en su chat', async () => {
    preparar(true);
    serviciosRepository.find.mockResolvedValue([
      cita({ cliente: { usuarioId: 'usr-cliente' } }),
    ]);

    await scheduler.checkUpcomingScheduledServices();

    expect(conversationNotifier.notifyClient).toHaveBeenCalledTimes(1);
    expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: 'cli-1',
        serviceId: 'srv-1',
        employeeId: 'emp-1',
        texto: 'Ya casi es la hora.',
      }),
    );
  });

  it('al cliente sin cuenta web no le sale nada por el chat', async () => {
    preparar(true);
    serviciosRepository.find.mockResolvedValue([cita()]);

    await scheduler.checkUpcomingScheduledServices();

    expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
  });

  it('no recuerda una cita que todavia esta lejos', async () => {
    preparar();
    serviciosRepository.find.mockResolvedValue([
      cita({ fechaProgramada: new Date(Date.now() + 3 * 3_600_000) }),
    ]);

    await scheduler.checkUpcomingScheduledServices();

    expect(notifications.notificar).not.toHaveBeenCalled();
    expect(serviciosRepository.save).not.toHaveBeenCalled();
  });
});
