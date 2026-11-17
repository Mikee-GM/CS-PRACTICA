import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';

/*
 * El frontend decide si muestra el cambio forzado con `debeCambiarPassword`,
 * que llega en `/auth/me` y en la respuesta del login (Fase 5, B-acceso).
 */
describe('debeCambiarPassword en /auth/me y en el login', () => {
  const controller = new AuthController(
    {} as AuthService,
    {} as never,
    {} as never,
  );
  const me = (user: Partial<Usuarios>) =>
    controller.me({ user } as unknown as Request);

  it.each([true, false])('/auth/me la devuelve tal cual (%p)', (marca) => {
    expect(
      me({
        id: 'u-1',
        email: 'a@b.c',
        rol: 'empleada',
        nombre: 'Ana',
        apellido: null,
        debeCambiarPassword: marca,
      }),
    ).toEqual({
      id: 'u-1',
      email: 'a@b.c',
      rol: 'empleada',
      nombre: 'Ana',
      apellido: null,
      debeCambiarPassword: marca,
    });
  });

  it('/auth/me la da en false si la fila aun no la trae', () => {
    expect(me({ id: 'u-1', email: 'a@b.c', rol: 'jefe' })).toMatchObject({
      debeCambiarPassword: false,
    });
  });

  it('el login la incluye en { user }', async () => {
    const passwordHash = await bcrypt.hash('temporal123', 4);
    const fila = {
      id: 'u-1',
      email: 'a@b.c',
      rol: 'chofer',
      activo: true,
      passwordHash,
      debeCambiarPassword: true,
    } as Usuarios;
    const qb = {
      addSelect: () => qb,
      where: () => qb,
      getOne: jest.fn().mockResolvedValue(fila),
    };
    const usuarios = {
      createQueryBuilder: () => qb,
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<Usuarios>;
    const sessions = {
      create: (d: Partial<AuthSession>) => ({ id: 'sid-1', ...d }),
      save: (s: AuthSession) => Promise.resolve(s),
    } as unknown as Repository<AuthSession>;
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('token'),
    } as unknown as JwtService;
    const config = {
      getOrThrow: () => 'secreto',
    } as unknown as ConfigService;

    const service = new AuthService(usuarios, sessions, jwt, config);
    const resultado = await service.login(
      { email: 'a@b.c', password: 'temporal123' },
      'dev-1',
    );

    expect(resultado.user).toEqual({
      id: 'u-1',
      email: 'a@b.c',
      rol: 'chofer',
      debeCambiarPassword: true,
    });
  });
});
