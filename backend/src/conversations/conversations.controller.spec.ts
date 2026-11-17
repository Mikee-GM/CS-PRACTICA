import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConversationsController } from './conversations.controller';

/*
 * El controlador entero es del cliente: si alguien añade una ruta sin
 * `@Roles('cliente')` o sin los guards, esta prueba lo detecta antes de que
 * quede abierta (o cerrada por accidente).
 */
describe('ConversationsController: guards y roles por ruta', () => {
  const prototipo = ConversationsController.prototype as unknown as Record<
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

  it('expone las cuatro rutas del cliente', () => {
    expect(rutas.map((r) => r.nombre).sort()).toEqual(
      ['list', 'listMessages', 'open', 'sendMessage'].sort(),
    );
  });

  it.each(['list', 'listMessages', 'open', 'sendMessage'])(
    '%s exige el rol cliente',
    (nombre) => {
      expect(
        Reflect.getMetadata(ROLES_KEY, prototipo[nombre] as object),
      ).toEqual(['cliente']);
    },
  );

  it.each(['list', 'listMessages', 'open', 'sendMessage'])(
    '%s pasa por JwtAuthGuard y RolesGuard',
    (nombre) => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        prototipo[nombre] as object,
      ) as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
    },
  );

  it('las rutas que escriben llevan ademas CsrfGuard', () => {
    for (const { nombre, handler } of rutas) {
      const metodo = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      ) as RequestMethod;
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      if (metodo === RequestMethod.GET) continue;
      expect({ nombre, csrf: guards.includes(CsrfGuard) }).toEqual({
        nombre,
        csrf: true,
      });
    }
  });

  it('las rutas que escriben tienen limite de ritmo propio', () => {
    for (const { nombre, handler } of rutas) {
      const metodo = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      ) as RequestMethod;
      if (metodo === RequestMethod.GET) continue;
      const limite = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as
        number | undefined;
      expect({ nombre, tipo: typeof limite }).toEqual({
        nombre,
        tipo: 'number',
      });
    }
  });
});
