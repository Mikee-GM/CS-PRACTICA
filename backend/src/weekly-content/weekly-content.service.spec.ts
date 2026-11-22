import { ConflictException } from '@nestjs/common';
import { WeeklyContentService } from './weekly-content.service';

/**
 * Lo que se protege aqui es el motivo del rechazo.
 *
 * Rechazar era un boton mudo: la modelo veia "No aprobada" en el portal y
 * volvia a mandar la misma clase de foto. Ahora el motivo se guarda con la
 * decision y sale por push, asi que lo que no puede fallar es que el motivo
 * acompañe al rechazo, que una aprobacion posterior lo borre, y que un fallo
 * del aviso no tumbe la revision, que ya esta decidida cuando se avisa.
 */
describe('WeeklyContentService.reviewSubmission', () => {
  const submissionRepo = { findOne: jest.fn(), save: jest.fn() };
  const scheduleRepo = {};
  const empleadasRepo = {};
  const fotosRepo = { find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const fotosExclusivasRepo = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const uploadService = {};
  const notifications = { notificar: jest.fn() };

  /*
   * Se construye por nombre y no con `new`.
   *
   * Con la lista posicional, cada dependencia nueva del servicio desplazaba todos
   * los dobles y estas pruebas fallaban por un motivo ajeno a lo que probaban.
   * Los campos inicializados de la clase entran como dobles porque
   * `Object.create` no los ejecuta.
   */
  const service = Object.create(
    WeeklyContentService.prototype,
  ) as WeeklyContentService;
  Object.assign(service, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    submissionRepo,
    scheduleRepo,
    empleadasRepo,
    fotosRepo,
    fotosExclusivasRepo,
    uploadService,
    notifications,
  });

  const revisor = { id: 'user-admin' } as any;

  /** Envio pendiente de una modelo. */
  const envio = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    empleadaId: 'emp-1',
    url: 'https://cdn.example.com/foto.jpg',
    estado: 'pendiente',
    motivoRechazo: null,
    empleada: { nombreArtistico: 'Modelo', usuarioId: 'user-1' },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Se reasigna en cada prueba y no solo al declararlo: clearAllMocks borra
    // las llamadas pero conserva la implementacion, asi que el rechazo que
    // simula el aviso caido se arrastraria a las siguientes.
    notifications.notificar.mockResolvedValue(1);
    submissionRepo.save.mockImplementation((valor) => valor);
    fotosRepo.find.mockResolvedValue([]);
    fotosRepo.create.mockImplementation((valor) => valor);
  });

  it('guarda el motivo y se lo manda a la modelo por push', async () => {
    submissionRepo.findOne.mockResolvedValue(envio());

    const resultado = await service.reviewSubmission(
      'sub-1',
      'rechazar',
      revisor,
      '  La foto esta movida.  ',
    );

    expect(resultado.estado).toBe('rechazada');
    expect(resultado.motivoRechazo).toBe('La foto esta movida.');

    const [usuarioId, aviso] = notifications.notificar.mock.calls[0];
    expect(usuarioId).toBe('user-1');
    expect(aviso.cuerpo).toContain('La foto esta movida.');
    expect(aviso.url).toBe('/empleada/portal?seccion=fotos');
  });

  it('avisa igual cuando se rechaza sin motivo', async () => {
    submissionRepo.findOne.mockResolvedValue(envio());

    const resultado = await service.reviewSubmission(
      'sub-1',
      'rechazar',
      revisor,
    );

    // Un motivo vacio no debe guardarse como cadena: el portal distingue
    // "sin motivo" por el nulo.
    expect(resultado.motivoRechazo).toBeNull();
    expect(notifications.notificar).toHaveBeenCalledTimes(1);
  });

  it('recorta un motivo largo para que quepa en el aviso', async () => {
    submissionRepo.findOne.mockResolvedValue(envio());

    await service.reviewSubmission(
      'sub-1',
      'rechazar',
      revisor,
      'x'.repeat(300),
    );

    const [, aviso] = notifications.notificar.mock.calls[0];
    expect(aviso.cuerpo.length).toBeLessThan(200);
    expect(aviso.cuerpo).toContain('...');
  });

  it('avisa a la modelo aunque no tenga un chat vinculado', async () => {
    submissionRepo.findOne.mockResolvedValue(
      envio({
        empleada: {
          nombreArtistico: 'Modelo',
          usuarioId: 'user-1',
          usuario: {},
        },
      }),
    );

    await service.reviewSubmission('sub-1', 'rechazar', revisor, 'Falta luz.');

    expect(notifications.notificar).toHaveBeenCalledTimes(1);
  });

  it('deja la revision guardada aunque falle el aviso', async () => {
    submissionRepo.findOne.mockResolvedValue(envio());
    notifications.notificar.mockRejectedValue(new Error('push caido'));

    await expect(
      service.reviewSubmission('sub-1', 'rechazar', revisor, 'Falta luz.'),
    ).resolves.toMatchObject({ estado: 'rechazada' });
  });

  it('borra el motivo anterior si la foto acaba aprobandose', async () => {
    submissionRepo.findOne.mockResolvedValue(
      envio({ estado: 'rechazada', motivoRechazo: 'La foto esta movida.' }),
    );

    const resultado = await service.reviewSubmission(
      'sub-1',
      'aprobar_publica',
      revisor,
    );

    expect(resultado.estado).toBe('aprobada_publica');
    expect(resultado.motivoRechazo).toBeNull();
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('no copia a la galeria una foto que ya estaba aprobada', async () => {
    submissionRepo.findOne.mockResolvedValue(
      envio({ estado: 'aprobada_publica' }),
    );

    await expect(
      service.reviewSubmission('sub-1', 'aprobar_publica', revisor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fotosRepo.save).not.toHaveBeenCalled();
    expect(submissionRepo.save).not.toHaveBeenCalled();
  });

  it('un reintento no duplica la foto que ya llego a la galeria', async () => {
    // El intento anterior copio la foto y fallo antes de guardar el estado.
    submissionRepo.findOne.mockResolvedValue(envio());
    fotosRepo.find.mockResolvedValue([
      { url: 'https://cdn.example.com/foto.jpg', orden: 0 },
    ]);

    const resultado = await service.reviewSubmission(
      'sub-1',
      'aprobar_publica',
      revisor,
    );

    expect(fotosRepo.save).not.toHaveBeenCalled();
    expect(resultado.estado).toBe('aprobada_publica');
  });
});

/**
 * Decision 3 de la Fase 5: al quitar el filtro por chat vinculado, la primera semana
 * en la que se le piden fotos a una modelo no tiene multa.
 */
describe('WeeklyContentService.esSemanaDeGracia', () => {
  const scheduleRepo = { count: jest.fn() };
  const service = Object.create(
    WeeklyContentService.prototype,
  ) as WeeklyContentService;
  Object.assign(service, { scheduleRepo });

  beforeEach(() => jest.clearAllMocks());

  it('es gracia la semana sin ningun ciclo anterior', async () => {
    scheduleRepo.count.mockResolvedValue(0);

    await expect(service.esSemanaDeGracia('emp-1', '2026-08-21')).resolves.toBe(
      true,
    );

    // Solo cuentan los ciclos anteriores, nunca el de la propia semana.
    const [{ where }] = scheduleRepo.count.mock.calls[0];
    expect(where.empleadaId).toBe('emp-1');
    expect(where.semanaInicio).toMatchObject({
      _type: 'lessThan',
      _value: '2026-08-21',
    });
  });

  it('no es gracia para quien ya tuvo ciclos', async () => {
    scheduleRepo.count.mockResolvedValue(4);

    await expect(service.esSemanaDeGracia('emp-1', '2026-08-21')).resolves.toBe(
      false,
    );
  });
});
