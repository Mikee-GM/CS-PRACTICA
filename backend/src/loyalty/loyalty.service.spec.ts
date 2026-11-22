import { ConflictException } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';

/**
 * Solo la violacion del indice unico significa "el nivel ya existe". Antes
 * cualquier fallo al guardar (base caida, deadlock) se le contaba al cliente
 * como un nivel repetido, y el error real no quedaba en ningun sitio.
 */
describe('LoyaltyService (niveles de membresia)', () => {
  const tiers = {
    create: jest.fn((valor: object) => ({ ...valor })),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const service = Object.create(LoyaltyService.prototype) as LoyaltyService;
  Object.assign(service, { tiersRepository: tiers });

  const dto = { code: ' VIP ', name: 'VIP', minSpend: 70000 } as never;

  beforeEach(() => jest.clearAllMocks());

  it('responde conflicto cuando el codigo ya existe', async () => {
    tiers.save.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    await expect(service.createTier(dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tiers.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'vip' }),
    );
  });

  it('deja pasar un fallo que no es de clave duplicada', async () => {
    const caida = new Error('conexion caida');
    tiers.save.mockRejectedValue(caida);

    await expect(service.createTier(dto)).rejects.toBe(caida);
  });

  it('al actualizar tampoco disfraza un fallo de base de datos', async () => {
    tiers.findOne.mockResolvedValue({ id: 't1', code: 'vip' });
    const caida = new Error('deadlock');
    tiers.save.mockRejectedValue(caida);

    await expect(service.updateTier('t1', { name: 'Nuevo' })).rejects.toBe(
      caida,
    );
  });
});
