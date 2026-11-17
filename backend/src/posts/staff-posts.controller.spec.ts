import { BadRequestException, RequestMethod } from '@nestjs/common';
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
import { StaffPostsController } from './staff-posts.controller';

/*
 * Todo el controlador es del equipo: si alguien añade una ruta sin
 * `@Roles('admin', 'jefe')` o sin los guards, esta prueba lo detecta. Sin
 * `@Roles`, `RolesGuard` dejaria pasar a empleadas y choferes.
 */
describe('StaffPostsController: guards y roles por ruta', () => {
  const prototipo = StaffPostsController.prototype as unknown as Record<
    string,
    object
  >;
  const rutas = Object.getOwnPropertyNames(prototipo)
    .filter((nombre) => nombre !== 'constructor')
    .map((nombre) => ({ nombre, handler: prototipo[nombre] }))
    .filter(
      ({ handler }) =>
        Reflect.getMetadata(METHOD_METADATA, handler) !== undefined,
    );

  const CONTRATO: Record<string, [RequestMethod, string]> = {
    listar: [RequestMethod.GET, '/'],
    obtener: [RequestMethod.GET, ':id'],
    aprobar: [RequestMethod.POST, ':id/approve'],
    rechazar: [RequestMethod.POST, ':id/reject'],
    archivar: [RequestMethod.POST, ':id/archive'],
    crear: [RequestMethod.POST, '/'],
    editar: [RequestMethod.PATCH, ':id'],
    agregarMedia: [RequestMethod.POST, ':id/media'],
    quitarMedia: [RequestMethod.DELETE, ':id/media/:mediaId'],
    reordenarMedia: [RequestMethod.PUT, ':id/media/order'],
    publicar: [RequestMethod.POST, ':id/publish'],
    borrar: [RequestMethod.DELETE, ':id'],
  };
  const NOMBRES = Object.keys(CONTRATO);

  it('vive bajo /staff/posts', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StaffPostsController)).toBe(
      'staff/posts',
    );
  });

  it('expone exactamente las doce rutas del equipo', () => {
    expect(rutas.map((r) => r.nombre).sort()).toEqual([...NOMBRES].sort());
  });

  it.each(NOMBRES)('%s tiene el metodo y la ruta acordados', (nombre) => {
    const [metodo, ruta] = CONTRATO[nombre];
    expect(Reflect.getMetadata(METHOD_METADATA, prototipo[nombre])).toBe(
      metodo,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototipo[nombre])).toBe(ruta);
  });

  it.each(NOMBRES)('%s exige admin o jefe y nunca cliente', (nombre) => {
    const roles = Reflect.getMetadata(ROLES_KEY, prototipo[nombre]) as string[];
    expect([...roles].sort()).toEqual(['admin', 'jefe']);
  });

  it.each(NOMBRES)('%s pasa por JwtAuthGuard y RolesGuard', (nombre) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      prototipo[nombre],
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('las rutas que escriben llevan CsrfGuard y limite de ritmo; las de lectura no llevan CSRF', () => {
    for (const { nombre, handler } of rutas) {
      const metodo = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      ) as RequestMethod;
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      const limite = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as
        number | undefined;
      if (metodo === RequestMethod.GET) {
        expect({ nombre, csrf: guards.includes(CsrfGuard) }).toEqual({
          nombre,
          csrf: false,
        });
        continue;
      }
      expect({
        nombre,
        csrf: guards.includes(CsrfGuard),
        limite: typeof limite,
      }).toEqual({ nombre, csrf: true, limite: 'number' });
    }
  });

  it.each(['aprobar', 'rechazar', 'archivar', 'publicar'])(
    '%s responde 200: no crea un recurso',
    (nombre) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototipo[nombre])).toBe(
        200,
      );
    },
  );

  it.each(['crear', 'agregarMedia'])('%s responde 201', (nombre) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototipo[nombre])).toBe(
      201,
    );
  });
});

describe('StaffPostsController: delegacion', () => {
  const actor = { id: 'jefe-1', rol: 'jefe' } as never;

  it('pasa actor, id y cuerpo al servicio sin decidir nada', async () => {
    const servicio = {
      rechazar: jest.fn().mockResolvedValue({}),
      crear: jest.fn().mockResolvedValue({}),
      publicar: jest.fn().mockResolvedValue({}),
    };
    const controller = new StaffPostsController(servicio as never);

    await controller.rechazar(actor, 'p1', { motivo: 'Foto borrosa' });
    await controller.crear(actor, { employeeId: 'e1', caption: 'Hola' });
    await controller.publicar(actor, 'p1');

    expect(servicio.rechazar).toHaveBeenCalledWith(actor, 'p1', 'Foto borrosa');
    expect(servicio.crear).toHaveBeenCalledWith(actor, {
      employeeId: 'e1',
      caption: 'Hola',
    });
    expect(servicio.publicar).toHaveBeenCalledWith(actor, 'p1');
  });

  it('la subida exige el campo file', () => {
    const servicio = { agregarMedia: jest.fn() };
    const controller = new StaffPostsController(servicio as never);

    expect(() => controller.agregarMedia(actor, 'p1', undefined, {})).toThrow(
      BadRequestException,
    );
    expect(servicio.agregarMedia).not.toHaveBeenCalled();
  });
});
