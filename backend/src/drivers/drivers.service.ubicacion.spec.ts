import { DriversService } from './drivers.service';

/**
 * El jefe tiene que ver por que un chofer "disponible" no recibe ofertas. La
 * marca `ubicacionVieja` sale de la misma condicion que aplica el reparto, y
 * la decide PostgreSQL: aqui se comprueba que se le pregunta y que se respeta
 * lo que contesta.
 */
describe('DriversService marca la ubicacion vieja', () => {
  const choferes = [
    { id: 'fresco', ultimaUbicacionAt: new Date() },
    { id: 'viejo', ultimaUbicacionAt: new Date('2026-01-01T00:00:00Z') },
  ];

  function crear() {
    const choferesRepository = {
      find: jest.fn().mockResolvedValue(choferes.map((c) => ({ ...c }))),
      findOne: jest.fn(),
    };
    const dataSource = {
      query: jest.fn((sql: string, _parametros?: unknown[]) => {
        if (sql.includes('disciplinary_sanctions')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: 'fresco' }]);
      }),
    };
    const service = new DriversService(
      choferesRepository as any,
      {} as any,
      {} as any,
      dataSource as any,
    );
    return { service, choferesRepository, dataSource };
  }

  it('al listar, marca solo a quien PostgreSQL no da por fresco', async () => {
    const { service, dataSource } = crear();

    const lista = await service.findAll();

    expect(lista.find((c) => c.id === 'fresco')?.ubicacionVieja).toBe(false);
    expect(lista.find((c) => c.id === 'viejo')?.ubicacionVieja).toBe(true);

    const consultaDeFrescura = dataSource.query.mock.calls.find(([sql]) =>
      sql.includes('ultima_ubicacion_at'),
    );
    expect(consultaDeFrescura?.[0]).toContain("interval '15 minutes'");
    expect(consultaDeFrescura?.[1]).toEqual([['fresco', 'viejo']]);
  });

  it('en la ficha de un chofer tambien la marca', async () => {
    const { service, choferesRepository } = crear();
    choferesRepository.findOne.mockResolvedValue({ id: 'viejo' });

    const chofer = await service.findOne('viejo');

    expect(chofer.ubicacionVieja).toBe(true);
  });
});
