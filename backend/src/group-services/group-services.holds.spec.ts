import { GroupServicesService } from './group-services.service';
import { GroupServiceRequest } from './entities/group-service-request.entity';

/**
 * Liberacion de reservas de grupo vencidas.
 *
 * Lo que se protege: las escrituras de una solicitud van en una transaccion
 * con la fila bloqueada, una solicitud que otro ya resolvio no se libera dos
 * veces, y un fallo del ciclo se registra en vez de tumbar el proceso.
 */
describe('GroupServicesService.releaseExpiredHolds', () => {
  const vencida = {
    id: 'sol-1',
    bossId: 'jefe-1',
    serviceId: 'serv-1',
    status: 'reservada',
    holdExpiresAt: new Date(Date.now() - 60_000),
  };

  let service: any;
  let manager: Record<string, jest.Mock>;
  let requests: { find: jest.Mock };
  let realtime: { emitToBoss: jest.Mock };
  let notifications: { notificar: jest.Mock };

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue({ ...vencida }),
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 'serv-1', estado: 'pendiente', totalPaid: 0 }),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((_entidad: unknown, valor: object) =>
        Promise.resolve(valor),
      ),
    };
    requests = { find: jest.fn().mockResolvedValue([{ ...vencida }]) };
    realtime = { emitToBoss: jest.fn() };
    notifications = { notificar: jest.fn().mockResolvedValue(1) };

    service = Object.create(GroupServicesService.prototype);
    Object.assign(service, {
      requests,
      realtime,
      notifications,
      logger: { warn: jest.fn(), error: jest.fn() },
      dataSource: {
        transaction: jest.fn((trabajo: (m: unknown) => unknown) =>
          trabajo(manager),
        ),
      },
    });
  });

  it('libera la solicitud y cancela el servicio sin pagos en una transaccion', async () => {
    await service.releaseExpiredHolds();

    expect(service.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(
      GroupServiceRequest,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    const guardados = manager.save.mock.calls.map(([, valor]) => valor);
    expect(guardados).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'serv-1', estado: 'cancelado' }),
        expect.objectContaining({
          id: 'sol-1',
          status: 'vencida',
          holdExpiresAt: null,
        }),
      ]),
    );
    expect(realtime.emitToBoss).toHaveBeenCalledTimes(1);
    expect(notifications.notificar).toHaveBeenCalledTimes(1);
  });

  it('no libera ni avisa una solicitud que otro ya resolvio', async () => {
    // Entre la lectura y el bloqueo otra replica la dejo vencida.
    manager.findOne.mockResolvedValue({
      ...vencida,
      status: 'vencida',
      holdExpiresAt: null,
    });

    await service.releaseExpiredHolds();

    expect(manager.save).not.toHaveBeenCalled();
    expect(realtime.emitToBoss).not.toHaveBeenCalled();
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('el ciclo registra el error en lugar de dejar un rechazo sin atender', async () => {
    service.dataSource.createQueryRunner = jest.fn(() => {
      throw new Error('sin conexion');
    });

    await expect(service.cicloDeLiberacion()).resolves.toBeUndefined();
    expect(service.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('sin conexion'),
    );
  });
});
