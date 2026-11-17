import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { UpdateUserDto } from './dto/update-user.dto';
import { Usuarios } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * `PATCH /users/:id` lo alcanza un jefe, y con `password` en el cuerpo podia
 * cambiar la clave de cualquier cuenta que no fuera admin: sin el alcance del
 * restablecimiento, sin cambio forzado y sin cerrar sesiones. Solo un admin
 * conserva ese camino; el resto usa el restablecimiento o el cambio propio.
 */
describe('UsersService.update: contraseña', () => {
  function build() {
    const update = jest.fn().mockResolvedValue(undefined);
    const repo = {
      update,
      findOne: jest.fn().mockResolvedValue({ id: 'u-1', rol: 'empleada' }),
    } as unknown as Repository<Usuarios>;
    return { service: new UsersService(repo), update };
  }

  const dto = { password: 'Secreta123' } as UpdateUserDto;
  const actor = (rol: Usuarios['rol'], id = 'a-1') => ({ id, rol }) as Usuarios;

  it('niega a un jefe cambiar la contraseña de otra cuenta', async () => {
    const { service, update } = build();

    await expect(
      service.update('u-1', dto, actor('jefe')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('deja a un admin cambiarla y obliga a la persona a elegir la suya', async () => {
    const { service, update } = build();

    await service.update('u-1', dto, actor('admin'));

    const [, datos] = update.mock.calls[0] as [
      string,
      { passwordHash: string; debeCambiarPassword?: boolean },
    ];
    expect(datos.debeCambiarPassword).toBe(true);
    await expect(
      bcrypt.compare('Secreta123', datos.passwordHash),
    ).resolves.toBe(true);
  });

  it('no marca el cambio forzado cuando el admin toca su propia cuenta', async () => {
    const { service, update } = build();

    await service.update('a-1', dto, actor('admin', 'a-1'));

    const [, datos] = update.mock.calls[0] as [
      string,
      { debeCambiarPassword?: boolean },
    ];
    expect(datos.debeCambiarPassword).toBeUndefined();
  });

  it('sigue dejando editar otros campos a un jefe', async () => {
    const { service, update } = build();

    await service.update(
      'u-1',
      { nombre: 'Ana' } as UpdateUserDto,
      actor('jefe'),
    );

    expect(update).toHaveBeenCalledWith('u-1', { nombre: 'Ana' });
  });
});
