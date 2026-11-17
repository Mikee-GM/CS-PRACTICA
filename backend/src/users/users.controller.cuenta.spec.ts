import {
  ArgumentMetadata,
  BadRequestException,
  HttpStatus,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
import { UsersController } from './users.controller';

/*
 * Rutas de la cuenta propia y del restablecimiento (Fase 5, B-acceso). Si una
 * pierde `@Roles`, un guard o su limite de ritmo, esta prueba lo detecta antes
 * de que quede abierta.
 */
describe('UsersController: acceso del personal (Fase 5)', () => {
  const prototipo = UsersController.prototype as unknown as Record<
    string,
    object
  >;
  const meta = (clave: string, nombre: string): unknown =>
    Reflect.getMetadata(clave, prototipo[nombre]);

  const PERSONAL = ['admin', 'jefe', 'empleada', 'chofer'];
  const CONTRATO = [
    {
      nombre: 'cambiarMiPassword',
      metodo: RequestMethod.PATCH,
      ruta: 'me/password',
      roles: PERSONAL,
      codigo: HttpStatus.NO_CONTENT,
      ritmo: { limit: 5, ttl: 60_000 },
    },
    {
      nombre: 'actualizarMiPerfil',
      metodo: RequestMethod.PATCH,
      ruta: 'me',
      roles: PERSONAL,
      codigo: undefined,
      ritmo: { limit: 10, ttl: 60_000 },
    },
    {
      nombre: 'restablecerPassword',
      metodo: RequestMethod.POST,
      ruta: ':id/reset-password',
      roles: ['admin', 'jefe'],
      codigo: HttpStatus.OK,
      ritmo: { limit: 10, ttl: 60_000 },
    },
  ];

  it.each(CONTRATO)('$nombre cuelga del metodo y la ruta del contrato', (r) => {
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toBe('users');
    expect(meta(METHOD_METADATA, r.nombre)).toBe(r.metodo);
    expect(meta(PATH_METADATA, r.nombre)).toBe(r.ruta);
    expect(meta(HTTP_CODE_METADATA, r.nombre)).toBe(r.codigo);
  });

  it.each(CONTRATO)('$nombre declara sus roles y nunca cliente', (r) => {
    expect(meta(ROLES_KEY, r.nombre)).toEqual(r.roles);
    expect(meta(ROLES_KEY, r.nombre)).not.toContain('cliente');
  });

  it.each(CONTRATO)(
    '$nombre escribe: pasa por JwtAuthGuard, RolesGuard y CsrfGuard',
    ({ nombre }) => {
      expect(meta(GUARDS_METADATA, nombre)).toEqual([
        JwtAuthGuard,
        RolesGuard,
        CsrfGuard,
      ]);
    },
  );

  it.each(CONTRATO)('$nombre tiene su limite de ritmo', ({ nombre, ritmo }) => {
    expect({
      limit: meta('THROTTLER:LIMITdefault', nombre),
      ttl: meta('THROTTLER:TTLdefault', nombre),
    }).toEqual(ritmo);
  });

  it('PATCH me se declara antes que PATCH :id para que no lo capture', () => {
    const orden = Object.getOwnPropertyNames(UsersController.prototype);
    expect(orden.indexOf('actualizarMiPerfil')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('actualizarMiPerfil')).toBeLessThan(
      orden.indexOf('update'),
    );
    expect(orden.indexOf('cambiarMiPassword')).toBeLessThan(
      orden.indexOf('update'),
    );
  });
});

/*
 * Mismo `ValidationPipe` que `main.ts`: es el que convierte un campo de mas en
 * un 400 en vez de ignorarlo.
 */
describe('DTOs de la cuenta propia con el ValidationPipe global', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validar = (metatype: ArgumentMetadata['metatype'], valor: object) =>
    pipe.transform(valor, { type: 'body', metatype });

  it.each([{ email: 'otro@x.com' }, { rol: 'admin' }, { activo: false }])(
    'PATCH me rechaza %p con 400',
    async (extra) => {
      await expect(
        validar(UpdateOwnProfileDto, { nombre: 'Ana', ...extra }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('PATCH me acepta nombre, apellido y telefono y los recorta', async () => {
    const dto = (await validar(UpdateOwnProfileDto, {
      nombre: '  Ana ',
      apellido: 'Ruiz',
      telefono: ' +524421234567 ',
    })) as UpdateOwnProfileDto;
    expect(dto).toEqual({
      nombre: 'Ana',
      apellido: 'Ruiz',
      telefono: '+524421234567',
    });
  });

  it('PATCH me rechaza un nombre vacio', async () => {
    await expect(
      validar(UpdateOwnProfileDto, { nombre: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['corta1', 'sinnumeros', '12345678', 'a1'.repeat(37)])(
    'me/password rechaza una nueva debil o demasiado larga (%s)',
    async (nueva) => {
      await expect(
        validar(ChangeOwnPasswordDto, { actual: 'x', nueva }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('me/password acepta una actual cualquiera y una nueva valida', async () => {
    await expect(
      validar(ChangeOwnPasswordDto, { actual: 'x', nueva: 'nueva12345' }),
    ).resolves.toBeDefined();
  });
});
