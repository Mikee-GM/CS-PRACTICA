import { ServicesService } from './services.service';

/**
 * Las condiciones con las que el reparto elige choferes (Fase 5).
 *
 * `modo_bot` ya no excluye a nadie, porque todos reciben la oferta en la
 * plataforma, y una posicion de hace mas de quince minutos no cuenta: ordenar
 * por cercania con ella le ofreceria el viaje a quien ya no esta ahi.
 */
describe('ServicesService.dispatchViaje: a quien se le ofrece el viaje', () => {
  function crear() {
    const condiciones: string[] = [];
    const consulta: Record<string, jest.Mock> = {};
    for (const metodo of [
      'innerJoinAndSelect',
      'where',
      'andWhere',
      'setParameter',
      'select',
      'addSelect',
      'orderBy',
    ]) {
      consulta[metodo] = jest.fn((arg: unknown) => {
        if (
          (metodo === 'where' || metodo === 'andWhere') &&
          typeof arg === 'string'
        ) {
          condiciones.push(arg);
        }
        return consulta;
      });
    }
    consulta.getRawAndEntities = jest
      .fn()
      .mockResolvedValue({ entities: [], raw: [] });

    const choferesRepository = {
      createQueryBuilder: jest.fn(() => consulta),
      // Lo usa el diagnostico cuando la lista sale vacia.
      query: jest.fn().mockResolvedValue([{}]),
    };
    const viajesRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'viaje',
        tipo: 'ida',
        estado: 'notificado',
        choferesNotificados: [],
        passengers: [],
        servicio: {
          id: 'servicio',
          jefeId: 'jefe',
          empleada: { ubicacionLat: 20.59, ubicacionLng: -100.39 },
        },
      }),
    };

    const service = Object.create(ServicesService.prototype) as ServicesService;
    Object.assign(service, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      waitTimeouts: new Map(),
      dispatchTimeouts: new Map(),
      viajesRepository,
      choferesRepository,
      configService: { get: jest.fn() },
    });
    const sinChoferes = jest
      .spyOn(service as any, 'notifyNoDriversAvailable')
      .mockResolvedValue(undefined);

    return { service, condiciones, sinChoferes };
  }

  it('no filtra por modo_bot', async () => {
    const { service, condiciones } = crear();

    await service.dispatchViaje('viaje');

    expect(condiciones.join('\n')).not.toContain('modo_bot');
  });

  it('exige una ubicacion de los ultimos quince minutos', async () => {
    const { service, condiciones } = crear();

    await service.dispatchViaje('viaje');

    expect(condiciones).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "chofer.ultima_ubicacion_at >= now() - interval '15 minutes'",
        ),
      ]),
    );
  });

  it('sin choferes elegibles avisa al jefe en vez de pasar solo a Uber', async () => {
    const { service, sinChoferes } = crear();

    await service.dispatchViaje('viaje');

    expect(sinChoferes).toHaveBeenCalledTimes(1);
  });
});
