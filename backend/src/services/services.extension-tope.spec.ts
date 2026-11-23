import { ConflictException } from '@nestjs/common';
import { ServicesService } from './services.service';

/**
 * Crear un servicio topa en 24 horas, pero extenderlo no: de +12 en +12 una
 * empleada llego a 53 horas y 79.500 de total sin aprobacion de nadie.
 */
describe('ServicesService.extendByEmployee: tope de duracion total', () => {
  function crear(duracionActual: number) {
    const servicio = {
      id: 'svc-1',
      estado: 'en_curso',
      duracionPactadaHoras: duracionActual,
      precioBaseHoraPactado: 1500,
      empleada: { usuarioId: 'user-1' },
    };
    const transaction = jest.fn();
    const service = Object.create(ServicesService.prototype) as ServicesService;
    Object.assign(service, {
      serviciosRepository: {
        findOne: jest.fn().mockResolvedValue(servicio),
        manager: { transaction },
      },
    });
    return { service, transaction };
  }

  it('rechaza una extension que lleva el total por encima de 24 horas', async () => {
    const { service, transaction } = crear(20);

    await expect(
      service.extendByEmployee('svc-1', 'user-1', 5),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('deja extender hasta llegar justo a 24 horas', async () => {
    const { service, transaction } = crear(20);
    transaction.mockRejectedValue(new Error('llego a la transaccion'));

    await expect(
      service.extendByEmployee('svc-1', 'user-1', 4),
    ).rejects.toThrow('llego a la transaccion');
  });
});
