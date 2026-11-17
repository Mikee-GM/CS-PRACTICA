import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { DriversService } from '../drivers/drivers.service';
import { CreateDriverDto } from '../drivers/dto/create-driver.dto';
import { CreateEmployeeDto } from '../employees/dto/create-employee.dto';
import { EmployeesService } from '../employees/employees.service';
import { CreateUserDto } from './dto/create-user.dto';
import { Usuarios } from './entities/user.entity';
import { UserSeederService } from './user-seeder.service';
import { UsersService } from './users.service';

/*
 * Toda cuenta de personal que nace con una contraseña tecleada por otra persona
 * sale marcada para cambiarla (Fase 5, B-acceso). La unica excepcion es el
 * admin sembrado, cuya contraseña viene de la configuracion del despliegue.
 */
function transaccionQueRegistra() {
  const creados: Array<{ entidad: unknown; datos: any }> = [];
  const manager = {
    create: jest.fn((entidad: unknown, datos: object) => {
      creados.push({ entidad, datos });
      return { id: `id-${creados.length}`, ...datos };
    }),
    save: jest.fn((_entidad: unknown, valor: unknown) =>
      Promise.resolve(valor),
    ),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  } as unknown as DataSource;
  const usuarioCreado = () =>
    creados.find((c) => c.entidad === Usuarios)?.datos as Partial<Usuarios>;
  return { dataSource, usuarioCreado };
}

const sinUsuarioPrevio = () =>
  ({
    findOne: jest.fn().mockResolvedValue(null),
  }) as unknown as Repository<any>;

describe('Alta de personal con cambio de contraseña obligatorio', () => {
  it('UsersService.create marca debeCambiarPassword', async () => {
    const repo = {
      create: jest.fn((data: Partial<Usuarios>) => ({ id: 'u-1', ...data })),
      save: jest.fn((u: Usuarios) => Promise.resolve(u)),
    } as unknown as Repository<Usuarios>;
    const service = new UsersService(repo);
    const creado = await service.create(
      {
        email: 'jefe@x.com',
        password: 'temporal123',
        rol: 'jefe',
      } as CreateUserDto,
      { id: 'admin-1', rol: 'admin' } as Usuarios,
    );
    expect(creado.debeCambiarPassword).toBe(true);
  });

  it('EmployeesService.create marca debeCambiarPassword', async () => {
    const { dataSource, usuarioCreado } = transaccionQueRegistra();
    const service = new EmployeesService(
      sinUsuarioPrevio(),
      sinUsuarioPrevio(),
      sinUsuarioPrevio(),
      dataSource,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.create({
      email: 'modelo@x.com',
      password: 'temporal123',
      nombreReal: 'Ana',
      nombreArtistico: 'Ana',
      slugCatalogo: 'ana',
      precioBaseHora: 1000,
    } as unknown as CreateEmployeeDto);
    expect(usuarioCreado()).toMatchObject({
      rol: 'empleada',
      debeCambiarPassword: true,
    });
  });

  it('DriversService.create marca debeCambiarPassword', async () => {
    const { dataSource, usuarioCreado } = transaccionQueRegistra();
    const service = new DriversService(
      sinUsuarioPrevio(),
      sinUsuarioPrevio(),
      sinUsuarioPrevio(),
      dataSource,
    );
    await service.create({
      email: 'chofer@x.com',
      password: 'temporal123',
      nombre: 'Luis',
    } as unknown as CreateDriverDto);
    expect(usuarioCreado()).toMatchObject({
      rol: 'chofer',
      debeCambiarPassword: true,
    });
  });

  it('el admin sembrado no queda forzado', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const creados: Array<Partial<Usuarios>> = [];
    const repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Partial<Usuarios>) => {
        creados.push(data);
        return data;
      }),
      save: jest.fn((u: Usuarios) => Promise.resolve(u)),
    } as unknown as Repository<Usuarios>;
    const config = {
      getOrThrow: jest.fn((clave: string) =>
        clave === 'DEFAULT_ADMIN_EMAIL' ? 'admin@x.com' : 'semilla123',
      ),
    } as unknown as ConfigService;

    await new UserSeederService(repo, config).onApplicationBootstrap();

    expect(creados).toHaveLength(1);
    expect(creados[0]).toMatchObject({
      rol: 'admin',
      debeCambiarPassword: false,
    });
  });
});
