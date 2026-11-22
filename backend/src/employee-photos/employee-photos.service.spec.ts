import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmployeePhotosService } from './employee-photos.service';
import { EmpleadaFotos } from './entities/employee-photo.entity';

/**
 * Mover una foto entre galerias copia y borra: si cada paso fuera por su
 * cuenta, un fallo a medias la dejaba en las dos y un doble toque la duplicaba.
 */
describe('EmployeePhotosService.moveBetweenGalleries', () => {
  const publicas = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((valor) => valor),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const exclusivas = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((valor) => valor),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const manager = {
    getRepository: jest.fn((entidad) =>
      entidad === EmpleadaFotos ? publicas : exclusivas,
    ),
  };
  const dataSource = {
    transaction: jest.fn((trabajo: (m: typeof manager) => unknown) =>
      trabajo(manager),
    ),
  };

  const service = new EmployeePhotosService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    exclusivas.find.mockResolvedValue([{ orden: 2 }, { orden: 5 }]);
    exclusivas.save.mockImplementation((valor) => ({ ...valor, id: 'nueva' }));
  });

  it('copia al final de la galeria destino y borra el origen en la transaccion', async () => {
    publicas.findOne.mockResolvedValue({
      id: 'foto-1',
      empleadaId: 'emp-1',
      url: 'https://cdn.example.com/a.jpg',
    });

    const resultado = await service.moveBetweenGalleries(
      'foto-1',
      'publica',
      'exclusiva',
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(publicas.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(exclusivas.save).toHaveBeenCalledWith(
      expect.objectContaining({ empleadaId: 'emp-1', orden: 6 }),
    );
    expect(publicas.delete).toHaveBeenCalledWith('foto-1');
    expect(resultado).toEqual({
      moved: true,
      id: 'nueva',
      gallery: 'exclusiva',
    });
  });

  it('no copia nada si la foto ya no esta en el origen', async () => {
    publicas.findOne.mockResolvedValue(null);

    await expect(
      service.moveBetweenGalleries('foto-1', 'publica', 'exclusiva'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(exclusivas.save).not.toHaveBeenCalled();
    expect(publicas.delete).not.toHaveBeenCalled();
  });

  it('rechaza mover una foto a la galeria en la que ya esta', async () => {
    await expect(
      service.moveBetweenGalleries('foto-1', 'publica', 'publica'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
