import { NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { PortalAuthGuard } from '../auth/guards/portal-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EmployeePostsController } from './employee-posts.controller';

const POST = '33333333-3333-4333-8333-333333333333';
const MEDIA = '44444444-4444-4444-8444-444444444444';

/*
 * Todo el controlador es del portal de la modelo. Si alguien añade una ruta
 * que no pase por `PortalAuthGuard`, o un parametro de ruta sin
 * `ParseUUIDPipe`, esta prueba lo detecta.
 */
describe('EmployeePostsController', () => {
  const prototipo = EmployeePostsController.prototype as unknown as Record<
    string,
    object
  >;
  const rutas = Object.getOwnPropertyNames(prototipo)
    .filter((nombre) => nombre !== 'constructor')
    .filter(
      (nombre) =>
        Reflect.getMetadata(METHOD_METADATA, prototipo[nombre]) !== undefined,
    );

  it('expone las ocho rutas de la modelo', () => {
    expect([...rutas].sort()).toEqual(
      [
        'agregarMedia',
        'borrar',
        'crear',
        'editar',
        'enviar',
        'listar',
        'quitarMedia',
        'reordenarMedia',
      ].sort(),
    );
  });

  it('todas las rutas pasan por PortalAuthGuard y no por RolesGuard', () => {
    const deClase = Reflect.getMetadata(
      GUARDS_METADATA,
      EmployeePostsController,
    ) as unknown[];
    expect(deClase).toEqual([PortalAuthGuard]);
    for (const nombre of rutas) {
      const propios = (Reflect.getMetadata(
        GUARDS_METADATA,
        prototipo[nombre],
      ) ?? []) as unknown[];
      expect({ nombre, roles: propios.includes(RolesGuard) }).toEqual({
        nombre,
        roles: false,
      });
    }
  });

  it('todo parametro de ruta pasa por ParseUUIDPipe', () => {
    let parametros = 0;
    for (const nombre of rutas) {
      const args = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        EmployeePostsController,
        nombre,
      ) ?? {}) as Record<string, { data?: string; pipes: unknown[] }>;
      for (const [clave, arg] of Object.entries(args)) {
        if (!clave.startsWith(`${RouteParamtypes.PARAM}:`)) continue;
        parametros += 1;
        expect({ nombre, param: arg.data, pipes: arg.pipes }).toEqual({
          nombre,
          param: arg.data,
          pipes: [ParseUUIDPipe],
        });
      }
    }
    // id en seis rutas y mediaId en una: si baja, alguien quito un parametro.
    expect(parametros).toBe(7);
  });

  describe('una cuenta que no es de empleada', () => {
    const postsService = {
      listarDeLaModelo: jest.fn(),
      crearBorrador: jest.fn(),
      editarCaption: jest.fn(),
      agregarMedia: jest.fn(),
      quitarMedia: jest.fn(),
      reordenarMedia: jest.fn(),
      enviar: jest.fn(),
      borrar: jest.fn(),
    };
    const employeesService = {
      findByUserId: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('Perfil de empleada no encontrado'),
        ),
    };
    const controller = new EmployeePostsController(
      postsService as never,
      employeesService as never,
    );
    const archivo = { file: [{ buffer: Buffer.from([1]) }] };

    it.each([
      ['listar', () => controller.listar('cliente-1', {})],
      ['crear', () => controller.crear('cliente-1', { caption: '' })],
      ['editar', () => controller.editar('cliente-1', POST, { caption: '' })],
      [
        'agregarMedia',
        () => controller.agregarMedia('cliente-1', POST, archivo, {}),
      ],
      ['quitarMedia', () => controller.quitarMedia('cliente-1', POST, MEDIA)],
      [
        'reordenarMedia',
        () => controller.reordenarMedia('cliente-1', POST, { ids: [MEDIA] }),
      ],
      ['enviar', () => controller.enviar('cliente-1', POST)],
      ['borrar', () => controller.borrar('cliente-1', POST)],
    ])('%s responde 404 sin llegar al servicio', async (_nombre, llamar) => {
      await expect(llamar()).rejects.toBeInstanceOf(NotFoundException);
      for (const metodo of Object.values(postsService)) {
        expect(metodo).not.toHaveBeenCalled();
      }
    });
  });

  it('opera siempre sobre la empleada de la cuenta del portal', async () => {
    const postsService = { enviar: jest.fn().mockResolvedValue({ id: POST }) };
    const employeesService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'empleada-1' }),
    };
    const controller = new EmployeePostsController(
      postsService as never,
      employeesService as never,
    );
    await controller.enviar('usuario-1', POST);
    expect(employeesService.findByUserId).toHaveBeenCalledWith('usuario-1');
    expect(postsService.enviar).toHaveBeenCalledWith(POST, 'empleada-1');
  });
});
