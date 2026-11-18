import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';

/**
 * El paso que separa autorizar un servicio de pedirle el Uber.
 *
 * El enlace salia en el mismo instante en que el jefe autorizaba, asi que el
 * coche llegaba mientras la modelo se estaba arreglando: o esperaba con el
 * taximetro corriendo, o habia que cancelarlo y pedir otro. Ahora el enlace
 * nace cuando ella avisa, y solo ella puede avisar.
 */
describe('ServicesService: la modelo avisa que ya esta lista', () => {
  const serviciosRepository = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const viajesRepository = { findOne: jest.fn() };
  const usuariosRepository = { findOneBy: jest.fn() };
  const realtime = { emitToBoss: jest.fn() };
  const notifications = { notificar: jest.fn().mockResolvedValue(1) };

  const service = Object.create(ServicesService.prototype) as ServicesService;
  Object.assign(service, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    serviciosRepository,
    viajesRepository,
    usuariosRepository,
    realtimeEventsService: realtime,
    notificationsService: notifications,
  });

  /** El UPDATE condicionado que hace de cerrojo. */
  const marcaQueGana = (affected: number) => {
    const execute = jest.fn().mockResolvedValue({ affected });
    serviciosRepository.createQueryBuilder.mockReturnValue({
      update: () => ({
        set: () => ({ where: () => ({ execute }) }),
      }),
    });
    return execute;
  };

  const servicioEnUber = (extra: Record<string, unknown> = {}) => ({
    id: 'srv-1',
    jefeId: 'jefe-1',
    empleadaId: 'emp-1',
    estado: 'en_curso',
    transporteAgendado: 'uber',
    empleadaListaAt: null,
    ubicacionClienteLat: 20.6,
    ubicacionClienteLng: -100.4,
    empleada: {
      id: 'emp-1',
      usuarioId: 'user-emp',
      nombreArtistico: 'Ana',
      ubicacionLat: 20.59,
      ubicacionLng: -100.39,
      usuario: {},
    },
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    viajesRepository.findOne.mockResolvedValue({ id: 'viaje-1' });
    usuariosRepository.findOneBy.mockResolvedValue({ id: 'jefe-1' });
  });

  it('solo la puede marcar la modelo asignada', async () => {
    serviciosRepository.findOne.mockResolvedValue(servicioEnUber());

    await expect(
      service.marcarEmpleadaLista('srv-1', 'otra-usuaria'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(serviciosRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('no aplica a un servicio que va con chofer propio', async () => {
    serviciosRepository.findOne.mockResolvedValue(
      servicioEnUber({ transporteAgendado: 'chofer' }),
    );

    await expect(
      service.marcarEmpleadaLista('srv-1', 'user-emp'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('le avisa al jefe por panel y push en cuanto ella avisa', async () => {
    serviciosRepository.findOne.mockResolvedValue(servicioEnUber());
    marcaQueGana(1);

    const resultado = await service.marcarEmpleadaLista('srv-1', 'user-emp');

    expect(resultado.yaEstaba).toBe(false);
    expect(resultado.uberLink).toContain('m.uber.com');
    expect(realtime.emitToBoss).toHaveBeenCalledWith(
      'jefe-1',
      expect.objectContaining({ type: 'employee_ready_for_service' }),
    );
    expect(notifications.notificar).toHaveBeenCalledWith(
      'jefe-1',
      expect.objectContaining({
        url: '/jefe',
        dedupeKey: 'boss:employee_ready_for_service:srv-1',
      }),
    );
  });

  /*
   * Dos toques seguidos --o dos dispositivos a la vez-- no
   * pueden avisar dos veces al jefe: el segundo encuentra la marca ya puesta.
   */
  it('avisa una sola vez aunque se toque dos veces', async () => {
    serviciosRepository.findOne.mockResolvedValue(
      servicioEnUber({ empleadaListaAt: new Date() }),
    );

    const resultado = await service.marcarEmpleadaLista('srv-1', 'user-emp');

    expect(resultado.yaEstaba).toBe(true);
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('tampoco avisa dos veces si las dos llegan a la vez', async () => {
    serviciosRepository.findOne.mockResolvedValue(servicioEnUber());
    marcaQueGana(0);

    const resultado = await service.marcarEmpleadaLista('srv-1', 'user-emp');

    expect(resultado.yaEstaba).toBe(true);
    expect(notifications.notificar).not.toHaveBeenCalled();
  });
});
