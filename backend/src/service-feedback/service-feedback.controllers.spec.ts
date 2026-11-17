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
import { ClientServiceFeedbackController } from './client-service-feedback.controller';
import { PortalServiceFeedbackController } from './portal-service-feedback.controller';

type Ruta = { nombre: string; handler: object };

function rutasDe(controlador: { prototype: object }): Ruta[] {
  const prototipo = controlador.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototipo)
    .filter((nombre) => nombre !== 'constructor')
    .map((nombre) => ({ nombre, handler: prototipo[nombre] as object }))
    .filter(
      ({ handler }) =>
        Reflect.getMetadata(METHOD_METADATA, handler) !== undefined,
    );
}

/*
 * `RolesGuard` niega a quien no figure en `@Roles`, asi que una ruta sin rol
 * quedaria cerrada para todos y una con el rol equivocado, abierta a quien no
 * toca. Estas pruebas fijan rol, guards, CSRF y limite de ritmo por ruta.
 */
const CASOS: Array<{
  controlador: { prototype: object };
  roles: Record<string, string[]>;
}> = [
  {
    controlador: ClientServiceFeedbackController,
    roles: {
      pendientes: ['cliente'],
      calificar: ['cliente'],
      reportar: ['cliente'],
      volverAContratar: ['cliente'],
    },
  },
  {
    controlador: PortalServiceFeedbackController,
    roles: {
      choferesPorCalificar: ['empleada'],
      reportarEmpleada: ['chofer'],
    },
  },
];

describe.each(CASOS)(
  '$controlador.name: guards y roles',
  ({ controlador, roles }) => {
    const rutas = rutasDe(controlador);

    it('expone exactamente las rutas esperadas', () => {
      expect(rutas.map((r) => r.nombre).sort()).toEqual(
        Object.keys(roles).sort(),
      );
    });

    it('cada ruta declara su rol', () => {
      for (const { nombre, handler } of rutas) {
        expect({
          nombre,
          roles: Reflect.getMetadata(ROLES_KEY, handler) as unknown,
        }).toEqual({ nombre, roles: roles[nombre] });
      }
    });

    it('cada ruta pasa por JwtAuthGuard y RolesGuard', () => {
      for (const { handler } of rutas) {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(
          expect.arrayContaining([JwtAuthGuard, RolesGuard]),
        );
      }
    });

    it('las que escriben llevan CsrfGuard y limite de ritmo', () => {
      for (const { nombre, handler } of rutas) {
        const metodo = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod;
        if (metodo === RequestMethod.GET) continue;
        const guards = Reflect.getMetadata(
          GUARDS_METADATA,
          handler,
        ) as unknown[];
        const limite = Reflect.getMetadata(
          'THROTTLER:LIMITdefault',
          handler,
        ) as number | undefined;
        expect({
          nombre,
          csrf: guards.includes(CsrfGuard),
          limite: typeof limite,
        }).toEqual({ nombre, csrf: true, limite: 'number' });
      }
    });
  },
);

describe('PortalServiceFeedbackController: rutas bajo el prefijo de cada portal', () => {
  const prototipo =
    PortalServiceFeedbackController.prototype as unknown as Record<
      string,
      object
    >;

  it('la lista de choferes vive en el portal de la modelo', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, prototipo.choferesPorCalificar),
    ).toBe('employee-portal/ratings/pending-drivers');
  });

  it('el reporte del chofer vive en su portal', () => {
    expect(Reflect.getMetadata(PATH_METADATA, prototipo.reportarEmpleada)).toBe(
      'driver-portal/employee-reports',
    );
  });

  it('la identidad sale de la sesion', async () => {
    const discipline = {
      listarChoferesPorCalificar: jest.fn().mockResolvedValue([]),
    };
    const feedback = {
      reportarDesdeElChofer: jest.fn().mockResolvedValue({ id: 'r-1' }),
    };
    const controller = new PortalServiceFeedbackController(
      feedback as never,
      discipline as never,
    );

    await controller.choferesPorCalificar({ id: 'usuario-1' } as never);
    await controller.reportarEmpleada({ id: 'usuario-2' } as never, {
      viajeId: 'viaje-1',
      categoria: 'otro',
      descripcion: 'Descripcion valida',
    });

    expect(discipline.listarChoferesPorCalificar).toHaveBeenCalledWith({
      id: 'usuario-1',
      rol: 'empleada',
    });
    expect(feedback.reportarDesdeElChofer).toHaveBeenCalledWith('usuario-2', {
      viajeId: 'viaje-1',
      categoria: 'otro',
      descripcion: 'Descripcion valida',
    });
  });
});

describe('ClientServiceFeedbackController: codigos de respuesta', () => {
  it('calificar y volver a contratar responden 201 o 200 segun creen o no', async () => {
    const feedback = {
      calificar: jest
        .fn()
        .mockResolvedValueOnce({ calificacion: { estrellas: 5 }, creada: true })
        .mockResolvedValueOnce({
          calificacion: { estrellas: 5 },
          creada: false,
        }),
      volverAContratar: jest
        .fn()
        .mockResolvedValueOnce({ conversation: { id: 'c-1' }, creada: false }),
    };
    const controller = new ClientServiceFeedbackController(feedback as never);
    const res = { status: jest.fn() };

    await controller.calificar(
      { id: 'u-1' } as never,
      's-1',
      { estrellas: 5 },
      res as never,
    );
    await controller.calificar(
      { id: 'u-1' } as never,
      's-1',
      { estrellas: 5 },
      res as never,
    );
    const conversacion = await controller.volverAContratar(
      { id: 'u-1' } as never,
      's-1',
      res as never,
    );

    expect(res.status.mock.calls).toEqual([[201], [200], [200]]);
    expect(conversacion).toEqual({ id: 'c-1' });
    expect(feedback.calificar).toHaveBeenCalledWith('u-1', 's-1', {
      estrellas: 5,
    });
  });
});
