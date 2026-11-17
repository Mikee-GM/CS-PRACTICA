import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { Empleadas } from '../employees/entities/employee.entity';
import { CuentaDelPersonalService } from './cuenta-del-personal.service';
import { Usuarios } from './entities/user.entity';

type Condicion = { sql: string; params: Record<string, unknown> };

/*
 * El acceso del personal sin Telegram ni correo (Fase 5, B-acceso). Lo que se
 * fija aqui es lo que hace segura la temporal: quien puede pedirla, que se
 * guarda hasheada, que tumba las sesiones y que nunca acaba en un log.
 */
function build(opciones: {
  usuario?: Partial<Usuarios> | null;
  objetivo?: Partial<Usuarios> | null;
  modelosDelJefe?: number;
}) {
  const actualizaciones: Array<{ where: unknown; cambios: any }> = [];
  const revocaciones: Condicion[][] = [];

  const manager = {
    update: jest.fn((_entidad: unknown, where: unknown, cambios: unknown) => {
      actualizaciones.push({ where, cambios });
      return Promise.resolve({ affected: 1 });
    }),
    createQueryBuilder: jest.fn(() => {
      const condiciones: Condicion[] = [];
      revocaciones.push(condiciones);
      const qb = {
        update: () => qb,
        set: () => qb,
        where: (sql: string, params: Record<string, unknown> = {}) => {
          condiciones.push({ sql, params });
          return qb;
        },
        andWhere: (sql: string, params: Record<string, unknown> = {}) => {
          condiciones.push({ sql, params });
          return qb;
        },
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      return qb;
    }),
  };
  const transaccion = jest.fn((cb: (m: typeof manager) => unknown) =>
    cb(manager),
  );
  const dataSource = { transaction: transaccion } as unknown as DataSource;

  const qbUsuario = {
    addSelect: () => qbUsuario,
    where: () => qbUsuario,
    andWhere: () => qbUsuario,
    getOne: jest.fn().mockResolvedValue(opciones.usuario ?? null),
  };
  const usuarios = {
    createQueryBuilder: jest.fn(() => qbUsuario),
    findOne: jest.fn().mockResolvedValue(opciones.objetivo ?? null),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const empleadas = {
    count: jest.fn().mockResolvedValue(opciones.modelosDelJefe ?? 0),
  };

  const service = new CuentaDelPersonalService(
    usuarios as unknown as Repository<Usuarios>,
    empleadas as unknown as Repository<Empleadas>,
    dataSource,
  );
  return {
    service,
    usuarios,
    empleadas,
    transaccion,
    actualizaciones,
    revocaciones,
  };
}

const sesion = { sid: 'sid-actual', familyId: 'fam-actual' };

describe('CuentaDelPersonalService.cambiarPassword', () => {
  let hashActual: string;
  beforeAll(async () => {
    hashActual = await bcrypt.hash('vieja1234', 4);
  });
  const usuario = () =>
    ({ id: 'u-1', rol: 'empleada', passwordHash: hashActual }) as Usuarios;

  it('rechaza una contraseña actual incorrecta sin tocar nada', async () => {
    const { service, transaccion } = build({ usuario: usuario() });
    await expect(
      service.cambiarPassword('u-1', sesion, {
        actual: 'otra1234',
        nueva: 'nueva12345',
      }),
    ).rejects.toThrow(
      new BadRequestException('La contraseña actual no es correcta'),
    );
    expect(transaccion).not.toHaveBeenCalled();
  });

  it('rechaza una nueva igual a la actual', async () => {
    const { service, transaccion } = build({ usuario: usuario() });
    await expect(
      service.cambiarPassword('u-1', sesion, {
        actual: 'vieja1234',
        nueva: 'vieja1234',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(transaccion).not.toHaveBeenCalled();
  });

  it('rechaza si la cuenta no es del personal (un cliente no la encuentra)', async () => {
    const { service } = build({ usuario: null });
    await expect(
      service.cambiarPassword('u-1', sesion, {
        actual: 'vieja1234',
        nueva: 'nueva12345',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('guarda el hash nuevo, quita la marca y revoca las otras sesiones conservando la actual', async () => {
    const { service, actualizaciones, revocaciones } = build({
      usuario: usuario(),
    });
    await service.cambiarPassword('u-1', sesion, {
      actual: 'vieja1234',
      nueva: 'nueva12345',
    });

    expect(actualizaciones).toHaveLength(1);
    const { where, cambios } = actualizaciones[0];
    expect(where).toEqual({ id: 'u-1' });
    expect(cambios.debeCambiarPassword).toBe(false);
    expect(cambios.passwordHash).not.toBe('nueva12345');
    await expect(
      bcrypt.compare('nueva12345', cambios.passwordHash),
    ).resolves.toBe(true);

    expect(revocaciones).toHaveLength(1);
    const condiciones = revocaciones[0];
    expect(condiciones[0]).toEqual({
      sql: 'user_id = :usuarioId AND revoked_at IS NULL',
      params: { usuarioId: 'u-1' },
    });
    expect(condiciones).toContainEqual({
      sql: 'id <> :sid',
      params: { sid: 'sid-actual' },
    });
    expect(condiciones).toContainEqual({
      sql: 'family_id <> :familyId',
      params: { familyId: 'fam-actual' },
    });
  });
});

describe('CuentaDelPersonalService.actualizarPerfil', () => {
  const perfil = {
    id: 'u-1',
    email: 'e@x.com',
    rol: 'chofer',
    nombre: 'Ana',
    apellido: null,
    telefono: null,
    debeCambiarPassword: true,
  } as Usuarios;

  it('solo actualiza nombre, apellido y telefono, y acotado al personal', async () => {
    const { service, usuarios } = build({ objetivo: perfil });
    await service.actualizarPerfil('u-1', {
      nombre: 'Ana',
      telefono: '',
      // Aunque se colara un campo (el ValidationPipe ya lo rechaza), el
      // servicio solo copia los tres permitidos.
      ...({ email: 'otro@x.com', rol: 'admin', activo: false } as object),
    });
    const [where, cambios] = usuarios.update.mock.calls[0];
    expect(where.id).toBe('u-1');
    expect(where.rol).toBeDefined();
    expect(cambios).toEqual({ nombre: 'Ana', telefono: null });
  });

  it('devuelve el perfil publico sin hash', async () => {
    const { service } = build({ objetivo: perfil });
    const resultado = await service.actualizarPerfil('u-1', {});
    expect(resultado).toEqual({
      id: 'u-1',
      email: 'e@x.com',
      rol: 'chofer',
      nombre: 'Ana',
      apellido: null,
      telefono: null,
      debeCambiarPassword: true,
    });
    expect(resultado).not.toHaveProperty('passwordHash');
  });

  it('sin campos no escribe', async () => {
    const { service, usuarios } = build({ objetivo: perfil });
    await service.actualizarPerfil('u-1', {});
    expect(usuarios.update).not.toHaveBeenCalled();
  });
});

describe('CuentaDelPersonalService.restablecerPassword', () => {
  const admin = { id: 'admin-1', rol: 'admin' } as const;
  const jefe = { id: 'jefe-1', rol: 'jefe' } as const;
  const objetivo = (rol: Usuarios['rol'], activo = true) =>
    ({ id: 'obj-1', rol, activo }) as Usuarios;

  let logs: jest.SpyInstance[];
  beforeEach(() => {
    logs = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
  });
  afterEach(() => logs.forEach((s) => s.mockRestore()));

  it.each(['admin', 'jefe', 'empleada', 'chofer'] as const)(
    'el admin restablece a un %s',
    async (rol) => {
      const { service } = build({ objetivo: objetivo(rol) });
      await expect(
        service.restablecerPassword(admin, 'obj-1'),
      ).resolves.toHaveProperty('passwordTemporal');
    },
  );

  it('el admin no puede restablecer a un cliente: 404', async () => {
    const { service } = build({ objetivo: objetivo('cliente') });
    await expect(service.restablecerPassword(admin, 'obj-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('un usuario que no existe: 404', async () => {
    const { service } = build({ objetivo: null });
    await expect(service.restablecerPassword(admin, 'obj-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('nadie se restablece a si mismo por esta via', async () => {
    const { service, usuarios } = build({ objetivo: objetivo('admin') });
    await expect(service.restablecerPassword(admin, 'admin-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(usuarios.findOne).not.toHaveBeenCalled();
  });

  it('el jefe restablece a una modelo de su equipo (principal o secundario)', async () => {
    const { service, empleadas } = build({
      objetivo: objetivo('empleada'),
      modelosDelJefe: 1,
    });
    await expect(
      service.restablecerPassword(jefe, 'obj-1'),
    ).resolves.toHaveProperty('passwordTemporal');
    expect(empleadas.count).toHaveBeenCalledWith({
      where: [
        { usuarioId: 'obj-1', jefeId: 'jefe-1' },
        { usuarioId: 'obj-1', jefeSecundarioId: 'jefe-1' },
      ],
    });
  });

  it('el jefe no alcanza a una modelo ajena: 404', async () => {
    const { service, transaccion } = build({
      objetivo: objetivo('empleada'),
      modelosDelJefe: 0,
    });
    await expect(service.restablecerPassword(jefe, 'obj-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(transaccion).not.toHaveBeenCalled();
  });

  it.each(['admin', 'jefe'] as const)(
    'el jefe no puede restablecer a un %s: 403 como el cerrojo de escalada',
    async (rol) => {
      const { service, transaccion } = build({ objetivo: objetivo(rol) });
      await expect(service.restablecerPassword(jefe, 'obj-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(transaccion).not.toHaveBeenCalled();
    },
  );

  it.each(['chofer', 'cliente'] as const)(
    'el jefe no alcanza a un %s: 404',
    async (rol) => {
      const { service } = build({ objetivo: objetivo(rol) });
      await expect(service.restablecerPassword(jefe, 'obj-1')).rejects.toThrow(
        NotFoundException,
      );
    },
  );

  it('una cuenta desactivada se rechaza con un aviso claro', async () => {
    const { service, transaccion } = build({
      objetivo: objetivo('empleada', false),
    });
    await expect(service.restablecerPassword(admin, 'obj-1')).rejects.toThrow(
      ConflictException,
    );
    expect(transaccion).not.toHaveBeenCalled();
  });

  it('una desactivada fuera del alcance del jefe responde 404, no 409', async () => {
    const { service } = build({
      objetivo: objetivo('empleada', false),
      modelosDelJefe: 0,
    });
    await expect(service.restablecerPassword(jefe, 'obj-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('guarda solo el hash, pone la marca y revoca TODAS las sesiones', async () => {
    const { service, actualizaciones, revocaciones } = build({
      objetivo: objetivo('chofer'),
    });
    const { passwordTemporal } = await service.restablecerPassword(
      admin,
      'obj-1',
    );

    expect(passwordTemporal.length).toBeGreaterThanOrEqual(12);
    expect(passwordTemporal.length).toBeLessThanOrEqual(72);
    expect(passwordTemporal).toMatch(/[A-Za-z]/);
    expect(passwordTemporal).toMatch(/\d/);

    const { where, cambios } = actualizaciones[0];
    expect(where).toEqual({ id: 'obj-1' });
    expect(cambios.debeCambiarPassword).toBe(true);
    expect(cambios.passwordHash).not.toContain(passwordTemporal);
    await expect(
      bcrypt.compare(passwordTemporal, cambios.passwordHash),
    ).resolves.toBe(true);

    // Una sola condicion: todas las sesiones vivas del usuario, sin excepcion.
    expect(revocaciones).toEqual([
      [
        {
          sql: 'user_id = :usuarioId AND revoked_at IS NULL',
          params: { usuarioId: 'obj-1' },
        },
      ],
    ]);
  });

  it('la temporal no aparece en ningun log', async () => {
    const { service } = build({ objetivo: objetivo('empleada') });
    const { passwordTemporal } = await service.restablecerPassword(
      admin,
      'obj-1',
    );
    const escrito = logs
      .flatMap((s) => s.mock.calls)
      .map((args) => JSON.stringify(args))
      .join('\n');
    expect(escrito).toContain('obj-1');
    expect(escrito).not.toContain(passwordTemporal);
  });

  it('cada restablecimiento genera una temporal distinta', async () => {
    const { service } = build({ objetivo: objetivo('empleada') });
    const a = await service.restablecerPassword(admin, 'obj-1');
    const b = await service.restablecerPassword(admin, 'obj-1');
    expect(a.passwordTemporal).not.toBe(b.passwordTemporal);
  });
});
