import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
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

  const NOMBRES = [
    'list',
    'get',
    'listMessages',
    'open',
    'sendMessage',
    'uploadReceipt',
    'sendMedia',
  ];

  it('expone las siete rutas del cliente', () => {
    expect(rutas.map((r) => r.nombre).sort()).toEqual([...NOMBRES].sort());
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

describe('ConversationsController: subida del comprobante', () => {
  const handler = (
    ConversationsController.prototype as unknown as Record<string, object>
  ).uploadReceipt;

  it('es POST /conversations/:id/receipt', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/receipt');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
  });

  it('limita el ritmo a 6 por minuto', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(6);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('recibe el archivo con FileInterceptor', () => {
    const interceptores = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      handler,
    ) as unknown[];
    expect(interceptores).toHaveLength(1);
  });

  it('delega en el servicio y responde 201 o 200 segun cree o no', async () => {
    const receipts = {
      subirComprobante: jest
        .fn()
        .mockResolvedValueOnce({ message: { id: 'm1' }, creado: true })
        .mockResolvedValueOnce({ message: { id: 'm1' }, creado: false }),
    };
    const controller = new ConversationsController({} as any, receipts as any);
    const res = { status: jest.fn() };
    const archivo = { buffer: Buffer.from('x') };

    await controller.uploadReceipt(
      { id: 'usuario-1' } as any,
      'conv-1',
      archivo,
      { clientMessageId: 'c1' },
      res as any,
    );
    await controller.uploadReceipt(
      { id: 'usuario-1' } as any,
      'conv-1',
      archivo,
      { clientMessageId: 'c1' },
      res as any,
    );

    expect(receipts.subirComprobante).toHaveBeenCalledWith(
      'usuario-1',
      'conv-1',
      archivo,
      { clientMessageId: 'c1' },
    );
    expect(res.status.mock.calls).toEqual([[201], [200]]);
  });
});
