import { NotFoundException } from '@nestjs/common';
import {
  ClientBenefitsService,
  DIAS_DE_VIGENCIA,
  PORCENTAJE_INSTALACION_APP,
} from './client-benefits.service';
import { BeneficioDeCliente } from './entities/client-benefit.entity';

const AHORA = new Date('2026-11-24T12:00:00Z');
const enDias = (d: number) => new Date(AHORA.getTime() + d * 86_400_000);

function armar(opciones: {
  beneficio?: Partial<BeneficioDeCliente> | null;
  servicios?: Record<string, { id: string; estado: string }>;
  cliente?: boolean;
}) {
  const servicios = opciones.servicios ?? {};
  const actualizaciones: Array<[unknown, string, Record<string, unknown>]> = [];
  const manager = {
    findOne: jest.fn((_entidad: unknown, args: { where: { id: string } }) =>
      Promise.resolve(servicios[args.where.id] ?? null),
    ),
    findOneOrFail: jest.fn(
      (_entidad: unknown, args: { where: { id: string } }) =>
        Promise.resolve({ id: args.where.id, recargado: true }),
    ),
    update: jest.fn(
      (entidad: unknown, id: string, datos: Record<string, unknown>) => {
        actualizaciones.push([entidad, id, datos]);
        return Promise.resolve();
      },
    ),
    getRepository: jest.fn(() => ({
      createQueryBuilder: () => {
        const qb: Record<string, unknown> = {};
        for (const m of ['setLock', 'where', 'andWhere']) qb[m] = () => qb;
        qb.getOne = () =>
          Promise.resolve(
            opciones.beneficio
              ? ({
                  id: 'b1',
                  porcentaje: 10,
                  caducaAt: enDias(30),
                  ...opciones.beneficio,
                } as BeneficioDeCliente)
              : null,
          );
        return qb;
      },
    })),
  };
  const repoBeneficios = {
    manager,
    findOne: jest.fn().mockResolvedValue(
      opciones.beneficio
        ? {
            id: 'b1',
            porcentaje: 10,
            caducaAt: enDias(30),
            servicioId: null,
            ...opciones.beneficio,
          }
        : null,
    ),
  };
  const repoClientes = {
    findOne: jest
      .fn()
      .mockResolvedValue(opciones.cliente === false ? null : { id: 'c1' }),
  };
  const servicio = new ClientBenefitsService(
    repoBeneficios as never,
    repoClientes as never,
  );
  return { servicio, manager, actualizaciones };
}

describe('ClientBenefitsService.estadoDeInstalacion', () => {
  it('sin fila, todavia no se reclamo y muestra lo que se ofrece', async () => {
    const { servicio } = armar({ beneficio: null });
    await expect(servicio.estadoDeInstalacion('u1')).resolves.toEqual({
      estado: 'sin_reclamar',
      porcentaje: PORCENTAJE_INSTALACION_APP,
      caducaAt: null,
    });
  });

  it('otorgado y sin servicio esta disponible', async () => {
    const { servicio } = armar({ beneficio: { servicioId: null } });
    expect((await servicio.estadoDeInstalacion('u1')).estado).toBe(
      'disponible',
    );
  });

  it('con un servicio vivo esta usado y con uno cancelado se devuelve', async () => {
    const vivo = armar({
      beneficio: { servicioId: 's1' },
      servicios: { s1: { id: 's1', estado: 'finalizado' } },
    });
    expect((await vivo.servicio.estadoDeInstalacion('u1')).estado).toBe(
      'usado',
    );

    const cancelado = armar({
      beneficio: { servicioId: 's1' },
      servicios: { s1: { id: 's1', estado: 'cancelado' } },
    });
    expect((await cancelado.servicio.estadoDeInstalacion('u1')).estado).toBe(
      'disponible',
    );
  });

  it('pasado el plazo esta caducado', async () => {
    const { servicio } = armar({
      beneficio: { servicioId: null, caducaAt: enDias(-1) },
    });
    expect((await servicio.estadoDeInstalacion('u1')).estado).toBe('caducado');
  });

  it('una cuenta sin ficha de cliente se rechaza', async () => {
    const { servicio } = armar({ cliente: false });
    await expect(servicio.estadoDeInstalacion('u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ClientBenefitsService.aplicarAlServicio', () => {
  const nuevo = { id: 'nuevo', clienteId: 'c1' } as never;

  it('sin beneficio devuelve el servicio tal cual', async () => {
    const { servicio, manager, actualizaciones } = armar({ beneficio: null });
    await expect(
      servicio.aplicarAlServicio(manager as never, nuevo),
    ).resolves.toBe(nuevo);
    expect(actualizaciones).toHaveLength(0);
  });

  it('aplica el porcentaje al servicio y registra cual lo uso', async () => {
    const { servicio, manager, actualizaciones } = armar({
      beneficio: { servicioId: null },
    });
    const resultado = await servicio.aplicarAlServicio(manager as never, nuevo);
    expect(actualizaciones).toEqual([
      [expect.anything(), 'nuevo', { descuentoClientePorcentaje: 10 }],
      [BeneficioDeCliente, 'b1', { servicioId: 'nuevo' }],
    ]);
    expect(resultado).toMatchObject({ id: 'nuevo', recargado: true });
  });

  it('no lo aplica si otro servicio vivo ya lo uso', async () => {
    const { servicio, manager, actualizaciones } = armar({
      beneficio: { servicioId: 's1' },
      servicios: { s1: { id: 's1', estado: 'pendiente' } },
    });
    await expect(
      servicio.aplicarAlServicio(manager as never, nuevo),
    ).resolves.toBe(nuevo);
    expect(actualizaciones).toHaveLength(0);
  });

  it('si el servicio anterior se cancelo, se lo quita y lo pasa al nuevo', async () => {
    const { servicio, manager, actualizaciones } = armar({
      beneficio: { servicioId: 's1' },
      servicios: { s1: { id: 's1', estado: 'cancelado' } },
    });
    await servicio.aplicarAlServicio(manager as never, nuevo);
    expect(actualizaciones.map(([, id, datos]) => [id, datos])).toEqual([
      ['s1', { descuentoClientePorcentaje: 0 }],
      ['nuevo', { descuentoClientePorcentaje: 10 }],
      ['b1', { servicioId: 'nuevo' }],
    ]);
  });

  it('un servicio sin cliente no recibe nada', async () => {
    const { servicio, manager } = armar({ beneficio: { servicioId: null } });
    const sinCliente = { id: 'x', clienteId: null } as never;
    await expect(
      servicio.aplicarAlServicio(manager as never, sinCliente),
    ).resolves.toBe(sinCliente);
  });
});

describe('vigencia', () => {
  it('el plazo es de 60 dias', () => {
    expect(DIAS_DE_VIGENCIA).toBe(60);
  });
});
