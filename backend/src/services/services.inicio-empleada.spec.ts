import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';

/**
 * Una empleada no atiende dos servicios a la vez. El inicio desde el portal
 * (`startByEmployee`) no lo comprobaba: con dos servicios listos, los dos se
 * iniciaban y quedaba con dos en curso, cada uno con su chofer.
 */
describe('ServicesService.startByEmployee: un solo servicio en curso', () => {
  function crear(yaEnCurso: { id: string } | null) {
    const transition = jest.fn().mockResolvedValue({ id: 'svc-2' });
    const lock = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOneOrFail: jest.fn().mockResolvedValue({ id: 'emp-1' }),
    };
    const manager = {
      getRepository: jest.fn(() => ({ createQueryBuilder: () => lock })),
      findOne: jest.fn().mockResolvedValue(yaEnCurso),
    };
    const serviciosRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'svc-2',
        empleadaId: 'emp-1',
        jefeId: 'jefe-1',
        empleada: { usuarioId: 'user-1' },
      }),
      manager: {
        transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    };
    const service = Object.create(ServicesService.prototype) as ServicesService;
    Object.assign(service, {
      serviciosRepository,
      serviceOperations: { transition },
      realtimeEventsService: { emitToBoss: jest.fn(), emitToEmployee: jest.fn() },
    });
    return { service, transition, manager };
  }

  it('inicia el servicio cuando no tiene otro en curso', async () => {
    const { service, transition } = crear(null);

    await service.startByEmployee('svc-2', 'user-1');

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition.mock.calls[0][3]).toEqual(
      expect.objectContaining({ manager: expect.anything() }),
    );
  });

  it('rechaza iniciarlo si ya atiende otro y no toca el estado', async () => {
    const { service, transition } = crear({ id: 'svc-1' });

    await expect(service.startByEmployee('svc-2', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it('busca otros servicios en curso distintos del que inicia', async () => {
    const { service, manager } = crear(null);

    await service.startByEmployee('svc-2', 'user-1');

    const donde = manager.findOne.mock.calls[0][1].where;
    expect(donde.empleadaId).toBe('emp-1');
    expect(donde.estado).toBe('en_curso');
    expect(donde.id).toBeDefined();
  });

  it('sigue negando a quien no es la empleada del servicio', async () => {
    const { service } = crear(null);

    await expect(service.startByEmployee('svc-2', 'otra')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
