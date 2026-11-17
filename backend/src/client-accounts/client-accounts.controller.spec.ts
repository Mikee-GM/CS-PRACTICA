import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientAccountsController } from './client-accounts.controller';
import { ClientAccountsService } from './client-accounts.service';

/*
 * Las rutas de la Fase 4 son solo del cliente. Si una pierde `@Roles` o sus
 * guards, esta prueba lo detecta antes de que quede abierta o cerrada.
 */
describe('ClientAccountsController: rutas del perfil (Fase 4)', () => {
  const prototipo = ClientAccountsController.prototype as unknown as Record<
    string,
    object
  >;
  const meta = (clave: string, nombre: string): unknown =>
    Reflect.getMetadata(clave, prototipo[nombre]);

  const CONTRATO = [
    {
      nombre: 'perfil',
      metodo: RequestMethod.GET,
      ruta: 'me/perfil',
      csrf: false,
      ritmo: null,
    },
    {
      nombre: 'actualizar',
      metodo: RequestMethod.PATCH,
      ruta: 'me',
      csrf: true,
      ritmo: { limit: 10, ttl: 60_000 },
    },
    {
      nombre: 'cambiarPassword',
      metodo: RequestMethod.POST,
      ruta: 'me/password',
      csrf: true,
      ritmo: { limit: 5, ttl: 60_000 },
    },
  ];

  it.each(CONTRATO)('$nombre cuelga del metodo y la ruta del contrato', (r) => {
    expect(Reflect.getMetadata(PATH_METADATA, ClientAccountsController)).toBe(
      'client-accounts',
    );
    expect(meta(METHOD_METADATA, r.nombre)).toBe(r.metodo);
    expect(meta(PATH_METADATA, r.nombre)).toBe(r.ruta);
  });

  it.each(CONTRATO)('$nombre exige el rol cliente', ({ nombre }) => {
    expect(meta(ROLES_KEY, nombre)).toEqual(['cliente']);
  });

  it.each(CONTRATO)(
    '$nombre pasa por JwtAuthGuard y RolesGuard, y por CsrfGuard si escribe',
    ({ nombre, csrf }) => {
      const guards = meta(GUARDS_METADATA, nombre) as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
      expect(guards.includes(CsrfGuard)).toBe(csrf);
    },
  );

  it.each(CONTRATO.filter((r) => r.ritmo))(
    '$nombre tiene su limite de ritmo',
    ({ nombre, ritmo }) => {
      expect({
        limit: meta('THROTTLER:LIMITdefault', nombre),
        ttl: meta('THROTTLER:TTLdefault', nombre),
      }).toEqual(ritmo);
    },
  );

  it('el cambio de contraseña responde 204', () => {
    expect(meta(HTTP_CODE_METADATA, 'cambiarPassword')).toBe(
      HttpStatus.NO_CONTENT,
    );
  });

  it('pasa al servicio el usuario y la sesion de la peticion', async () => {
    const servicio = {
      perfil: jest.fn().mockResolvedValue({}),
      actualizarNombre: jest.fn().mockResolvedValue({ nombre: 'Ana' }),
      cambiarPassword: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ClientAccountsController(
      servicio as unknown as ClientAccountsService,
    );
    const actor = { id: 'usuario-1' } as never;
    const sesion = { sid: 's-1', familyId: 'f-1' };
    const dto = { actual: 'vieja1234', nueva: 'nueva12345' };

    await controller.perfil(actor);
    await controller.actualizar(actor, { nombre: 'Ana' });
    await controller.cambiarPassword(actor, sesion, dto);

    expect(servicio.perfil).toHaveBeenCalledWith('usuario-1');
    expect(servicio.actualizarNombre).toHaveBeenCalledWith('usuario-1', 'Ana');
    expect(servicio.cambiarPassword).toHaveBeenCalledWith(
      'usuario-1',
      sesion,
      dto,
    );
  });
});
