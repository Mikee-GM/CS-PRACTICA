import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffConversationsController } from './staff-conversations.controller';

/*
 * Todo el controlador es del equipo: si alguien añade una ruta sin
 * `@Roles('admin', 'jefe')` o sin los guards, esta prueba lo detecta. Sin
 * `@Roles`, `RolesGuard` dejaria pasar a empleadas y choferes.
 */
describe('StaffConversationsController: guards y roles por ruta', () => {
  const prototipo = StaffConversationsController.prototype as unknown as Record<
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
    list: [RequestMethod.GET, '/'],
    listMessages: [RequestMethod.GET, ':id/messages'],
    takeOver: [RequestMethod.POST, ':id/take-over'],
    release: [RequestMethod.POST, ':id/release'],
    sendMessage: [RequestMethod.POST, ':id/messages'],
    accept: [RequestMethod.POST, ':id/accept'],
    reject: [RequestMethod.POST, ':id/reject'],
  };
  const NOMBRES = Object.keys(CONTRATO);

  it('vive bajo /staff/conversations', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, StaffConversationsController),
    ).toBe('staff/conversations');
  });

  it('expone exactamente las siete rutas del equipo', () => {
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

  it('las rutas que escriben llevan CsrfGuard y limite de ritmo', () => {
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

  it.each(['takeOver', 'release', 'accept', 'reject'])(
    '%s responde 200: no crea un recurso',
    (nombre) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototipo[nombre])).toBe(
        200,
      );
    },
  );
});

describe('StaffConversationsController: delegacion', () => {
  const actor = { id: 'jefe-1', rol: 'jefe' } as any;

  it('enviar responde 201 nuevo y 200 en el reintento', async () => {
    const servicio = {
      enviarMensaje: jest
        .fn()
        .mockResolvedValueOnce({ message: { id: 'm1' }, creado: true })
        .mockResolvedValueOnce({ message: { id: 'm1' }, creado: false }),
    };
    const controller = new StaffConversationsController(servicio as any);
    const res = { status: jest.fn() };
    const dto = { body: 'hola', clientMessageId: 'c1' };

    await controller.sendMessage(actor, 'conv-1', dto, res as any);
    await controller.sendMessage(actor, 'conv-1', dto, res as any);

    expect(servicio.enviarMensaje).toHaveBeenCalledWith(actor, 'conv-1', dto);
    expect(res.status.mock.calls).toEqual([[201], [200]]);
  });

  it('pasa forzar y motivo al servicio sin decidir nada', async () => {
    const servicio = {
      tomarControl: jest.fn().mockResolvedValue({}),
      liberar: jest.fn().mockResolvedValue({}),
      rechazar: jest.fn().mockResolvedValue({}),
    };
    const controller = new StaffConversationsController(servicio as any);

    await controller.takeOver(actor, 'conv-1', { forzar: true });
    await controller.release(actor, 'conv-1', {});
    await controller.reject(actor, 'conv-1', { motivo: 'sin cupo' });

    expect(servicio.tomarControl).toHaveBeenCalledWith(actor, 'conv-1', true);
    expect(servicio.liberar).toHaveBeenCalledWith(actor, 'conv-1', undefined);
    expect(servicio.rechazar).toHaveBeenCalledWith(actor, 'conv-1', 'sin cupo');
  });
});
