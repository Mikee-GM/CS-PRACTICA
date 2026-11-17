import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Mailer } from '../common/mail/mailer';
import { ClientAccountsService } from './client-accounts.service';
import { RegisterClientDto } from './dto/register-client.dto';

const dto: RegisterClientDto = {
  email: 'cliente@example.com',
  password: 'secreta123',
  nombre: 'Carlos',
  mayorDeEdad: true,
  aceptaTerminos: true,
};

function crear(manager: Record<string, jest.Mock>) {
  const mailer = { enviar: jest.fn().mockResolvedValue(undefined) };
  const dataSource = {
    transaction: jest.fn((fn: (m: unknown) => Promise<unknown>) => fn(manager)),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue('https://sitio.test,http://x'),
  };
  const servicio = new ClientAccountsService(
    dataSource as unknown as DataSource,
    {} as never,
    {} as never,
    {} as never,
    mailer as unknown as Mailer,
    config as unknown as ConfigService,
  );
  return { servicio, mailer };
}

function managerDeRegistro(existe: boolean) {
  const consulta = {
    where: jest.fn().mockReturnThis(),
    getExists: jest.fn().mockResolvedValue(existe),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(consulta),
    create: jest.fn((_entidad: unknown, datos: object) => ({ ...datos })),
    save: jest.fn((entidad: object) =>
      Promise.resolve({ id: 'u-1', ...entidad }),
    ),
  };
}

describe('ClientAccountsService', () => {
  describe('register', () => {
    it('crea cuenta y ficha, y manda el enlace con el primer origen de WEB_URL', async () => {
      const manager = managerDeRegistro(false);
      const { servicio, mailer } = crear(manager);

      const usuario = await servicio.register(dto);

      expect(usuario.rol).toBe('cliente');
      expect(usuario.email).toBe('cliente@example.com');
      // Nunca se guarda la contrasena en claro.
      expect(usuario.passwordHash).not.toBe(dto.password);
      expect(manager.save).toHaveBeenCalledTimes(3);
      const correo = (mailer.enviar.mock.calls[0] as [{ texto: string }])[0];
      expect(correo.texto).toMatch(
        /^Confirma tu correo[\s\S]*https:\/\/sitio\.test\/verificar-correo\?token=[0-9a-f]{64}/,
      );
    });

    it('responde 409 si el correo ya existe, sin crear nada', async () => {
      const manager = managerDeRegistro(true);
      const { servicio, mailer } = crear(manager);

      await expect(servicio.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(mailer.enviar).not.toHaveBeenCalled();
    });

    it('traduce la violacion del indice unico a 409', async () => {
      const manager = managerDeRegistro(false);
      manager.save.mockRejectedValueOnce({ code: '23505' });
      const { servicio } = crear(manager);

      await expect(servicio.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('un fallo del correo no deshace el registro', async () => {
      const manager = managerDeRegistro(false);
      const { servicio, mailer } = crear(manager);
      mailer.enviar.mockRejectedValueOnce(new Error('sin proveedor'));

      await expect(servicio.register(dto)).resolves.toMatchObject({
        rol: 'cliente',
      });
    });
  });

  describe('verify', () => {
    const token = 'a'.repeat(64);

    it('marca el correo como verificado cuando el token vale', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue([[{ usuario_id: 'u-1' }], 1]),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const { servicio } = crear(manager);

      await servicio.verify(token);

      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        { usuarioId: 'u-1' },
        { correoVerificadoAt: expect.any(Date) as Date },
      );
    });

    it('rechaza un token usado, vencido o inexistente', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue([[], 0]),
        update: jest.fn(),
      };
      const { servicio } = crear(manager);

      await expect(servicio.verify(token)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('consulta por la huella del token, no por el token', async () => {
      const manager = {
        query: jest.fn().mockResolvedValue([[], 0]),
        update: jest.fn(),
      };
      const { servicio } = crear(manager);
      await servicio.verify(token).catch(() => undefined);

      const parametros = (
        manager.query.mock.calls[0] as [string, unknown[]]
      )[1];
      expect(parametros[0]).not.toBe(token);
      expect(parametros[0]).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
