import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UpdateUserDto } from './dto/update-user.dto';
import { Usuarios } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * TypeORM rechaza un UPDATE sin valores (`UpdateValuesMissingError`): un PATCH
 * con cuerpo vacio terminaba en 500. Y borrar un usuario que no existe
 * respondia `deleted: true` como si hubiera borrado algo.
 */
describe('UsersService: cuerpo vacio y borrado de un usuario inexistente', () => {
  function build(affected = 1) {
    const update = jest.fn().mockResolvedValue(undefined);
    const repo = {
      update,
      delete: jest.fn().mockResolvedValue({ affected }),
      findOne: jest.fn().mockResolvedValue({ id: 'u-1', rol: 'empleada' }),
    } as unknown as Repository<Usuarios>;
    return { service: new UsersService(repo), update };
  }

  const admin = { id: 'a-1', rol: 'admin' } as Usuarios;

  it('un PATCH vacio no ejecuta el UPDATE y devuelve el usuario', async () => {
    const { service, update } = build();

    const usuario = await service.update('u-1', {} as UpdateUserDto, admin);

    expect(update).not.toHaveBeenCalled();
    expect(usuario).toBeDefined();
  });

  it('un PATCH con datos sigue actualizando', async () => {
    const { service, update } = build();

    await service.update('u-1', { nombre: 'Ana' } as UpdateUserDto, admin);

    expect(update).toHaveBeenCalledWith('u-1', { nombre: 'Ana' });
  });

  it('borrar un usuario que existe responde deleted', async () => {
    const { service } = build(1);

    await expect(service.remove('u-1')).resolves.toEqual({ deleted: true });
  });

  it('borrar un usuario que no existe responde 404', async () => {
    const { service } = build(0);

    await expect(service.remove('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
