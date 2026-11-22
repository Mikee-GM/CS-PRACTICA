import { WeeklyContentScheduler } from './weekly-content.scheduler';

/**
 * Lo que se protege aqui es el conteo de avisos y la multa.
 *
 * El ciclo anterior mandaba un unico recordatorio y abria un reporte que nadie
 * miraba. Ahora la modelo tiene tres oportunidades y una consecuencia concreta,
 * asi que las dos cosas que no pueden fallar son que el contador no se pase del
 * tope y que la multa no se cobre dos veces.
 */
describe('WeeklyContentScheduler', () => {
  const SEMANA = '2026-08-21';

  const weeklyContentService = {
    getCurrentCycleFriday: () => SEMANA,
    getFinePolicy: jest.fn(),
    esSemanaDeGracia: jest.fn(),
  };
  const notifications = { notificar: jest.fn() };
  const scheduleRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((valor) => valor),
  };
  const empleadasRepo = { find: jest.fn() };
  const conductReportRepo = {
    save: jest.fn(),
    create: jest.fn((valor) => valor),
  };
  const dataSource = { query: jest.fn() };

  /*
   * Se construye por nombre y no por posicion.
   *
   * Con la lista posicional, cada dependencia nueva del servicio desplazaba
   * todos los dobles y las pruebas fallaban por un motivo ajeno a lo que
   * probaban. Paso cinco veces en una sola tanda de trabajo. El registro entra
   * como doble porque `Object.create` no ejecuta los campos inicializados de la
   * clase.
   */
  const scheduler = Object.create(
    WeeklyContentScheduler.prototype,
  ) as WeeklyContentScheduler;
  Object.assign(scheduler, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    weeklyContentService,
    notifications,
    scheduleRepo,
    empleadasRepo,
    conductReportRepo,
    dataSource,
  });

  /** Ciclo pendiente de una modelo. Ya no hace falta un chat vinculado. */
  const pendiente = (overrides: Record<string, unknown> = {}) => ({
    id: 'sched-1',
    empleadaId: 'emp-1',
    semanaInicio: SEMANA,
    estado: 'solicitado',
    recordatoriosEnviados: 0,
    recordatorioAt: null,
    multaAplicadaAt: null,
    multaLiquidationRecordId: null,
    empleada: { nombreArtistico: 'Modelo', usuarioId: 'user-1' },
    ...overrides,
  });

  /** El aviso de la llamada `n` a `notificar`. */
  const aviso = (n = 0) => notifications.notificar.mock.calls[n][1];

  beforeEach(() => {
    jest.clearAllMocks();
    weeklyContentService.getFinePolicy.mockResolvedValue({
      maxRecordatorios: 3,
      importeMulta: 300,
    });
    weeklyContentService.esSemanaDeGracia.mockResolvedValue(false);
    notifications.notificar.mockResolvedValue(1);
    scheduleRepo.save.mockImplementation((valor) =>
      Promise.resolve({ id: 'sched-nuevo', ...valor }),
    );
  });

  /** Los handlers son privados; se llaman por nombre para no simular el reloj. */
  const pedirFotos = () =>
    (scheduler as any).handleFridayRequests(SEMANA) as Promise<void>;
  const enviarRecordatorios = () =>
    (scheduler as any).handleReminders(SEMANA) as Promise<void>;
  const aplicarMultas = () =>
    (scheduler as any).handleExhaustedReminders(SEMANA) as Promise<void>;

  /*
   * Decision 3 de la Fase 5: el filtro por chat vinculado dejaba fuera del
   * ciclo, y de la multa, a toda modelo sin bot.
   */
  it('pide las fotos tambien a la modelo sin chat vinculado', async () => {
    empleadasRepo.find.mockResolvedValue([
      { id: 'emp-1', usuarioId: 'user-1', usuario: {} },
    ]);
    scheduleRepo.findOne.mockResolvedValue(null);

    await pedirFotos();

    expect(scheduleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ empleadaId: 'emp-1', estado: 'solicitado' }),
    );
    expect(notifications.notificar).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        url: '/empleada/portal?seccion=fotos',
        dedupeKey: 'fotos-solicitud:sched-nuevo',
      }),
    );
  });

  it('no vuelve a pedir las fotos a quien ya tiene ciclo esta semana', async () => {
    empleadasRepo.find.mockResolvedValue([{ id: 'emp-1', usuarioId: 'u' }]);
    scheduleRepo.findOne.mockResolvedValue(pendiente());

    await pedirFotos();

    expect(scheduleRepo.save).not.toHaveBeenCalled();
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('cuenta el recordatorio y avisa por push hacia el portal', async () => {
    const schedule = pendiente();
    scheduleRepo.find.mockResolvedValue([schedule]);

    await enviarRecordatorios();

    expect(schedule.recordatoriosEnviados).toBe(1);
    expect(schedule.estado).toBe('recordatorio_enviado');
    expect(notifications.notificar.mock.calls[0][0]).toBe('user-1');
    expect(aviso().titulo).toContain('1 de 3');
    expect(aviso().url).toBe('/empleada/portal?seccion=fotos');
    // El numero en la clave evita repetir el aviso si el guardado falla.
    expect(aviso().dedupeKey).toBe('fotos-recordatorio:sched-1:1');
  });

  it('avisa cuantos avisos quedan antes de la multa', async () => {
    scheduleRepo.find.mockResolvedValue([
      pendiente({ recordatoriosEnviados: 1 }),
    ]);

    await enviarRecordatorios();

    expect(aviso().titulo).toContain('2 de 3');
    expect(aviso().cuerpo).toContain('1 aviso');
  });

  it('en la semana de gracia el recordatorio dice que no hay multa', async () => {
    weeklyContentService.esSemanaDeGracia.mockResolvedValue(true);
    scheduleRepo.find.mockResolvedValue([pendiente()]);

    await enviarRecordatorios();

    expect(aviso().cuerpo).toContain('no hay multa');
  });

  it('no manda un segundo recordatorio el mismo dia', async () => {
    scheduleRepo.find.mockResolvedValue([
      pendiente({ recordatoriosEnviados: 1, recordatorioAt: new Date() }),
    ]);

    await enviarRecordatorios();

    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('deja de avisar al agotar el tope configurado', async () => {
    scheduleRepo.find.mockResolvedValue([
      pendiente({ recordatoriosEnviados: 3 }),
    ]);

    await enviarRecordatorios();

    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('cuenta el recordatorio aunque el aviso falle', async () => {
    // Si un fallo del aviso frenara el contador, la multa no llegaria nunca.
    notifications.notificar.mockRejectedValue(new Error('push caido'));
    const schedule = pendiente();
    scheduleRepo.find.mockResolvedValue([schedule]);

    await enviarRecordatorios();

    expect(schedule.recordatoriosEnviados).toBe(1);
  });

  it('aplica la multa al agotarse los avisos y la deja rastreada', async () => {
    const schedule = pendiente({
      recordatoriosEnviados: 3,
      estado: 'recordatorio_enviado',
    });
    scheduleRepo.find.mockResolvedValue([schedule]);
    dataSource.query
      // Primero se mira si el ciclo ya tenia multa registrada.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'jefe-1', rol: 'jefe' }])
      .mockResolvedValueOnce([{ id: 'registro-1' }]);

    await aplicarMultas();

    expect(schedule.estado).toBe('falta_aplicada');
    expect(schedule.multaAplicadaAt).toBeInstanceOf(Date);
    expect(schedule.multaLiquidationRecordId).toBe('registro-1');

    const [insercion, parametros] = dataSource.query.mock.calls[2];
    expect(insercion).toContain('INSERT INTO liquidation_records');
    expect(parametros).toContain(300);

    expect(aviso().titulo).toContain('multa');
    expect(aviso().tipo).toBe('sancion');
    expect(aviso().dedupeKey).toBe('fotos-multa:sched-1');
  });

  it('un reintento reutiliza la multa ya insertada en vez de cobrarla otra vez', async () => {
    // La pasada anterior inserto la multa y fallo al marcar el ciclo.
    const schedule = pendiente({
      recordatoriosEnviados: 3,
      estado: 'recordatorio_enviado',
    });
    scheduleRepo.find.mockResolvedValue([schedule]);
    dataSource.query.mockResolvedValueOnce([{ id: 'registro-previo' }]);

    await aplicarMultas();

    expect(schedule.multaLiquidationRecordId).toBe('registro-previo');
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('en la semana de gracia cierra el ciclo sin multa ni reporte', async () => {
    weeklyContentService.esSemanaDeGracia.mockResolvedValue(true);
    const schedule = pendiente({ recordatoriosEnviados: 3 });
    scheduleRepo.find.mockResolvedValue([schedule]);

    await aplicarMultas();

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(conductReportRepo.save).not.toHaveBeenCalled();
    expect(schedule.multaAplicadaAt).toBeNull();
    // Cerrado: la pasada siguiente ya no lo encuentra entre los pendientes.
    expect(schedule.estado).toBe('falta_aplicada');
    expect(aviso().titulo).toContain('no se aplico multa');
  });

  it('no vuelve a multar un ciclo que ya la tiene', async () => {
    scheduleRepo.find.mockResolvedValue([
      pendiente({ recordatoriosEnviados: 3, multaAplicadaAt: new Date() }),
    ]);

    await aplicarMultas();

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(conductReportRepo.save).not.toHaveBeenCalled();
  });

  it('no multa a quien todavia tiene avisos por gastar', async () => {
    scheduleRepo.find.mockResolvedValue([
      pendiente({ recordatoriosEnviados: 2 }),
    ]);

    await aplicarMultas();

    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('registra el incumplimiento aunque no haya quien firme la multa', async () => {
    const schedule = pendiente({ recordatoriosEnviados: 3 });
    scheduleRepo.find.mockResolvedValue([schedule]);
    // Sin multa previa y sin nadie que pueda firmarla.
    dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await aplicarMultas();

    expect(schedule.multaLiquidationRecordId).toBeNull();
    expect(conductReportRepo.save).toHaveBeenCalledTimes(1);
    expect(schedule.estado).toBe('falta_aplicada');
  });
});
