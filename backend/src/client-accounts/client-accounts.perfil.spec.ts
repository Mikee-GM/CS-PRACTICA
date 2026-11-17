import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { ClientAccountsService } from './client-accounts.service';
import { NivelDelClienteService } from './nivel-del-cliente.service';

/*
 * Perfil, nombre y contraseña del cliente (Fase 4). Van aparte de
 * `client-accounts.service.spec.ts`, que cubre registro y verificacion.
 */

type Filas = {
  calificacion?: { promedio: number | null; cantidad: number };
  finalizados?: number;
  sancion?: boolean;
};

const CREADO = new Date('2026-03-01T15:00:00.000Z');

function fichaDeCliente() {
  return {
    id: 'cliente-1',
    usuarioId: 'usuario-1',
    createdAt: CREADO,
    correoVerificadoAt: new Date(),
    usuario: {
      id: 'usuario-1',
      email: 'cliente@example.com',
      nombre: 'Carlos',
      passwordHash: 'no-debe-salir',
    },
  };
}

function crear(opciones: {
  ficha?: unknown;
  filas?: Filas;
  usuarioConHash?: { id: string; passwordHash: string } | null;
  afectadas?: number;
}) {
  const filas = opciones.filas ?? {};
  const query = jest.fn((consulta: string) => {
    if (consulta.includes('interaction_ratings')) {
      return Promise.resolve([
        filas.calificacion ?? { promedio: null, cantidad: 0 },
      ]);
    }
    if (consulta.includes('FROM servicios')) {
      return Promise.resolve([{ finalizados: filas.finalizados ?? 0 }]);
    }
    if (consulta.includes('disciplinary_sanctions')) {
      return Promise.resolve([{ vigente: filas.sancion ?? false }]);
    }
    return Promise.reject(new Error(`consulta inesperada: ${consulta}`));
  });

  const revocacion = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 2 }),
  };
  const manager = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue(revocacion),
  };
  const dataSource = {
    query,
    transaction: jest.fn((fn: (m: unknown) => Promise<unknown>) => fn(manager)),
  };

  const lecturaDeHash = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(opciones.usuarioConHash ?? null),
  };
  const usuariosRepository = {
    update: jest
      .fn()
      .mockResolvedValue({ affected: opciones.afectadas ?? 1, raw: [] }),
    createQueryBuilder: jest.fn().mockReturnValue(lecturaDeHash),
  };
  const clientesRepository = {
    findOne: jest.fn().mockResolvedValue(opciones.ficha ?? null),
  };

  const servicio = new ClientAccountsService(
    dataSource as unknown as DataSource,
    usuariosRepository as never,
    clientesRepository as never,
    {} as never,
    { enviar: jest.fn() },
    {} as never,
    new NivelDelClienteService(),
  );
  return {
    servicio,
    query,
    manager,
    revocacion,
    lecturaDeHash,
    usuariosRepository,
  };
}

describe('ClientAccountsService.perfil', () => {
  it('devuelve exactamente las claves del contrato', async () => {
    const { servicio } = crear({
      ficha: fichaDeCliente(),
      filas: {
        calificacion: { promedio: 4.67, cantidad: 3 },
        finalizados: 5,
      },
    });

    const perfil = await servicio.perfil('usuario-1');

    expect(Object.keys(perfil).sort()).toEqual(
      [
        'calificacion',
        'correoVerificado',
        'email',
        'estado',
        'miembroDesde',
        'nivel',
        'nombre',
        'servicios',
      ].sort(),
    );
    expect(Object.keys(perfil.calificacion).sort()).toEqual([
      'cantidad',
      'promedio',
    ]);
    expect(Object.keys(perfil.nivel).sort()).toEqual(['codigo', 'nombre']);
    expect(perfil).toEqual({
      nombre: 'Carlos',
      email: 'cliente@example.com',
      correoVerificado: true,
      miembroDesde: '2026-03-01T15:00:00.000Z',
      servicios: 5,
      calificacion: { promedio: 4.67, cantidad: 3 },
      nivel: { codigo: 'inicial', nombre: 'Inicial' },
      estado: 'activa',
    });
  });

  it('no filtra ids internos, comentarios ni datos de la calificacion', async () => {
    const { servicio } = crear({
      ficha: fichaDeCliente(),
      filas: {
        calificacion: {
          promedio: 3,
          cantidad: 4,
          // Aunque la consulta trajera de mas, no debe llegar al cliente.
          comment: 'interno',
          employee_id: 'e-1',
          appeal_status: 'none',
        } as never,
      },
    });

    const texto = JSON.stringify(await servicio.perfil('usuario-1'));

    expect(texto).not.toMatch(
      /"id"|comment|employee|appeal|cliente-1|usuario-1|passwordHash|no-debe-salir/,
    );
  });

  it('marca la cuenta restringida con una sancion vigente sin exponer nada de ella', async () => {
    const { servicio } = crear({
      ficha: fichaDeCliente(),
      filas: { sancion: true },
    });

    const perfil = await servicio.perfil('usuario-1');
    const texto = JSON.stringify(perfil);

    expect(perfil.estado).toBe('restringida');
    expect(texto).not.toMatch(
      /reason|motivo|suspension|permanent_ban|endsAt|ends_at|starts/i,
    );
  });

  it('oculta el promedio con menos de tres calificaciones', async () => {
    const { servicio } = crear({
      ficha: fichaDeCliente(),
      filas: { calificacion: { promedio: 1, cantidad: 2 } },
    });

    await expect(servicio.perfil('usuario-1')).resolves.toMatchObject({
      calificacion: { promedio: null, cantidad: 2 },
    });
  });

  it('consulta por el id de la ficha, no por el de la cuenta', async () => {
    const { servicio, query } = crear({ ficha: fichaDeCliente() });

    await servicio.perfil('usuario-1');

    for (const llamada of query.mock.calls as unknown as [
      string,
      unknown[],
    ][]) {
      expect(llamada[1]).toEqual(['cliente-1']);
    }
  });

  it('sin ficha de cliente responde 404', async () => {
    const { servicio, query } = crear({ ficha: null });

    await expect(servicio.perfil('usuario-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ClientAccountsService.actualizarNombre', () => {
  it('actualiza solo la columna del nombre de una cuenta de cliente', async () => {
    const { servicio, usuariosRepository } = crear({});

    await expect(
      servicio.actualizarNombre('usuario-1', 'Carlos Andrés'),
    ).resolves.toEqual({ nombre: 'Carlos Andrés' });
    expect(usuariosRepository.update).toHaveBeenCalledWith(
      { id: 'usuario-1', rol: 'cliente' },
      { nombre: 'Carlos Andrés' },
    );
  });

  it('responde 404 si no hay cuenta de cliente que actualizar', async () => {
    const { servicio } = crear({ afectadas: 0 });

    await expect(
      servicio.actualizarNombre('usuario-1', 'Carlos'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClientAccountsService.cambiarPassword', () => {
  let hashActual: string;

  beforeAll(async () => {
    hashActual = await bcrypt.hash('vieja1234', 4);
  });

  const sesion = { sid: 'sesion-actual', familyId: 'familia-actual' };

  it('rechaza una contraseña actual incorrecta con un mensaje generico', async () => {
    const { servicio, manager } = crear({
      usuarioConHash: { id: 'usuario-1', passwordHash: hashActual },
    });

    const intento = servicio.cambiarPassword('usuario-1', sesion, {
      actual: 'equivocada1',
      nueva: 'nueva12345',
    });

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow(
      'La contraseña actual no es correcta',
    );
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('sin cuenta responde lo mismo que con la contraseña incorrecta', async () => {
    const { servicio } = crear({ usuarioConHash: null });

    await expect(
      servicio.cambiarPassword('usuario-1', sesion, {
        actual: 'vieja1234',
        nueva: 'nueva12345',
      }),
    ).rejects.toThrow('La contraseña actual no es correcta');
  });

  it('rechaza una nueva igual a la actual', async () => {
    const { servicio, manager } = crear({
      usuarioConHash: { id: 'usuario-1', passwordHash: hashActual },
    });

    await expect(
      servicio.cambiarPassword('usuario-1', sesion, {
        actual: 'vieja1234',
        nueva: 'vieja1234',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('pide el hash con addSelect porque la columna es select: false', async () => {
    const { servicio, lecturaDeHash } = crear({
      usuarioConHash: { id: 'usuario-1', passwordHash: hashActual },
    });

    await servicio.cambiarPassword('usuario-1', sesion, {
      actual: 'vieja1234',
      nueva: 'nueva12345',
    });

    expect(lecturaDeHash.addSelect).toHaveBeenCalledWith('u.passwordHash');
  });

  it('guarda un hash nuevo y revoca las demas sesiones conservando la actual, en una transaccion', async () => {
    const { servicio, manager, revocacion } = crear({
      usuarioConHash: { id: 'usuario-1', passwordHash: hashActual },
    });

    await servicio.cambiarPassword('usuario-1', sesion, {
      actual: 'vieja1234',
      nueva: 'nueva12345',
    });

    const [, criterio, cambios] = manager.update.mock.calls[0] as [
      unknown,
      { id: string },
      { passwordHash: string },
    ];
    expect(criterio).toEqual({ id: 'usuario-1' });
    // Solo cambia la columna del hash.
    expect(Object.keys(cambios)).toEqual(['passwordHash']);
    expect(cambios.passwordHash).not.toBe(hashActual);
    expect(cambios.passwordHash).not.toBe('nueva12345');
    await expect(
      bcrypt.compare('nueva12345', cambios.passwordHash),
    ).resolves.toBe(true);

    expect(revocacion.where).toHaveBeenCalledWith(
      'user_id = :usuarioId AND revoked_at IS NULL',
      { usuarioId: 'usuario-1' },
    );
    expect(revocacion.andWhere).toHaveBeenCalledWith('id <> :sid', {
      sid: 'sesion-actual',
    });
    expect(revocacion.andWhere).toHaveBeenCalledWith('family_id <> :familyId', {
      familyId: 'familia-actual',
    });
    expect(revocacion.execute).toHaveBeenCalledTimes(1);
  });

  it('sin familia en el token conserva al menos la sesion actual', async () => {
    const { servicio, revocacion } = crear({
      usuarioConHash: { id: 'usuario-1', passwordHash: hashActual },
    });

    await servicio.cambiarPassword(
      'usuario-1',
      { sid: 'sesion-actual', familyId: null },
      { actual: 'vieja1234', nueva: 'nueva12345' },
    );

    expect(revocacion.andWhere).toHaveBeenCalledTimes(1);
    expect(revocacion.andWhere).toHaveBeenCalledWith('id <> :sid', {
      sid: 'sesion-actual',
    });
  });
});
