import { ServicesService } from './services.service';
import { ADVISORY_LOCKS } from '../common/scheduling/advisory-lock';

/**
 * Los ciclos de prorroga y de transporte de regreso avisan al personal y no
 * son idempotentes: con dos replicas cada aviso salia duplicado. Aqui se
 * protege que corran bajo advisory lock y que un fallo nunca escape al
 * intervalo.
 */
describe('ServicesService.ejecutarConLock', () => {
  const runner = { connect: jest.fn(), query: jest.fn(), release: jest.fn() };
  const dataSource = { createQueryRunner: () => runner };
  const logger = { error: jest.fn() };

  const service = Object.create(ServicesService.prototype) as ServicesService;
  Object.assign(service, {
    logger,
    serviciosRepository: { manager: { connection: dataSource } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ejecuta la tarea con la clave registrada y suelta el lock', async () => {
    runner.query.mockResolvedValueOnce([{ locked: true }]);
    const tarea = jest.fn().mockResolvedValue(undefined);

    await service.ejecutarConLock(
      ADVISORY_LOCKS.returnTransportReminders,
      'prueba',
      tarea,
    );

    expect(tarea).toHaveBeenCalledTimes(1);
    expect(runner.query.mock.calls[0][1]).toEqual([811_024]);
    expect(runner.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
  });

  it('se salta el turno si otra replica tiene el lock', async () => {
    runner.query.mockResolvedValueOnce([{ locked: false }]);
    const tarea = jest.fn();

    await service.ejecutarConLock(
      ADVISORY_LOCKS.serviceExtensionCheck,
      'prueba',
      tarea,
    );

    expect(tarea).not.toHaveBeenCalled();
  });

  it('registra el fallo de la tarea y no rechaza', async () => {
    runner.query.mockResolvedValue([{ locked: true }]);

    await expect(
      service.ejecutarConLock(811_023, 'revisando algo', () =>
        Promise.reject(new Error('boom')),
      ),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('revisando algo'),
    );
  });
});
