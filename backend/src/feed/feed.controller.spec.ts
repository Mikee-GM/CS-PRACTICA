import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

/*
 * El controlador entero es del cliente: si alguien añade una ruta sin
 * `@Roles('cliente')` o sin los guards, esta prueba lo detecta antes de que
 * quede abierta (o cerrada por accidente).
 */
describe('FeedController: guards y roles por ruta', () => {
  const prototipo = FeedController.prototype as unknown as Record<
    string,
    unknown
  >;
  const rutas = Object.getOwnPropertyNames(prototipo)
    .filter((nombre) => nombre !== 'constructor')
    .map((nombre) => ({ nombre, handler: prototipo[nombre] as object }))
    .filter(
      ({ handler }) =>
        Reflect.getMetadata(METHOD_METADATA, handler) !== undefined,
    );

  const NOMBRES = ['list', 'listModel', 'like', 'unlike'];

  it('expone las cuatro rutas del cliente', () => {
    expect(rutas.map((r) => r.nombre).sort()).toEqual([...NOMBRES].sort());
  });

  it('cuelga de /feed con los metodos y rutas del contrato', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FeedController)).toBe('feed');
    const contrato = rutas
      .map(({ nombre, handler }) => ({
        nombre,
        metodo: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
        ruta: Reflect.getMetadata(PATH_METADATA, handler) as string,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    expect(contrato).toEqual([
      { nombre: 'like', metodo: RequestMethod.PUT, ruta: 'posts/:id/like' },
      { nombre: 'list', metodo: RequestMethod.GET, ruta: '/' },
      { nombre: 'listModel', metodo: RequestMethod.GET, ruta: 'models/:slug' },
      {
        nombre: 'unlike',
        metodo: RequestMethod.DELETE,
        ruta: 'posts/:id/like',
      },
    ]);
  });

  it.each(NOMBRES)('%s exige el rol cliente', (nombre) => {
    expect(Reflect.getMetadata(ROLES_KEY, prototipo[nombre] as object)).toEqual(
      ['cliente'],
    );
  });

  it.each(NOMBRES)('%s pasa por JwtAuthGuard y RolesGuard', (nombre) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      prototipo[nombre] as object,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('solo las rutas que escriben llevan CsrfGuard', () => {
    for (const { nombre, handler } of rutas) {
      const metodo = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      ) as RequestMethod;
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      expect({ nombre, csrf: guards.includes(CsrfGuard) }).toEqual({
        nombre,
        csrf: metodo !== RequestMethod.GET,
      });
    }
  });

  it('las rutas que escriben tienen limite de ritmo de 60 por minuto', () => {
    for (const { nombre, handler } of rutas) {
      const metodo = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      ) as RequestMethod;
      if (metodo === RequestMethod.GET) continue;
      expect({
        nombre,
        limit: Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as number,
        ttl: Reflect.getMetadata('THROTTLER:TTLdefault', handler) as number,
      }).toEqual({ nombre, limit: 60, ttl: 60_000 });
    }
  });

  it('pasa al servicio el usuario de la sesion, nunca un id de cliente', async () => {
    const servicio = {
      listFeed: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listModelFeed: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
      like: jest.fn().mockResolvedValue({ liked: true, likeCount: 1 }),
      unlike: jest.fn().mockResolvedValue({ liked: false, likeCount: 0 }),
    };
    const controller = new FeedController(servicio as unknown as FeedService);
    const actor = { id: 'usuario-1' } as never;

    await controller.list(actor, { limit: 5 });
    await controller.listModel(actor, 'valentina', {});
    await controller.like(actor, 'post-1');
    await controller.unlike(actor, 'post-1');

    expect(servicio.listFeed).toHaveBeenCalledWith('usuario-1', { limit: 5 });
    expect(servicio.listModelFeed).toHaveBeenCalledWith(
      'usuario-1',
      'valentina',
      {},
    );
    expect(servicio.like).toHaveBeenCalledWith('usuario-1', 'post-1');
    expect(servicio.unlike).toHaveBeenCalledWith('usuario-1', 'post-1');
  });
});
