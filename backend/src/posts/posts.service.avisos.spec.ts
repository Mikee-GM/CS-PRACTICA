import { ConflictException, Logger } from '@nestjs/common';
import type { PostStatus } from './entities/post.entity';
import { PostsService } from './posts.service';

const MODELO = '11111111-1111-4111-8111-111111111111';
const POST = '33333333-3333-4333-8333-333333333333';

/*
 * Avisos en vivo de `PostsService` (B6): `post_pending` a los jefes de la
 * modelo cuando un post entra a revision. El resto del comportamiento lo
 * cubre `posts.service.spec.ts`; aqui solo importa cuando se avisa y que un
 * fallo del aviso no cambie el resultado.
 */
function crearEntorno(opciones: {
  status?: PostStatus;
  enviado?: boolean;
  jefes?: { jefe_id: string | null; jefe_secundario_id: string | null };
  conRealtime?: boolean;
}) {
  const status = opciones.status ?? 'borrador';
  const query = jest.fn((sql: string) => {
    const texto = sql.trim();
    if (/^WITH enviado/.test(texto)) {
      return Promise.resolve(opciones.enviado === false ? [] : [{ id: POST }]);
    }
    if (/^SELECT jefe_id/.test(texto)) {
      return Promise.resolve([
        opciones.jefes ?? { jefe_id: 'jefe-1', jefe_secundario_id: 'jefe-2' },
      ]);
    }
    if (/^SELECT status FROM posts/.test(texto)) {
      return Promise.resolve([{ status }]);
    }
    if (/AS medias/.test(texto)) {
      return Promise.resolve([{ medias: 1, videos: 0 }]);
    }
    if (/WITH editado/.test(texto)) return Promise.resolve([{ id: POST }]);
    return Promise.reject(new Error(`Consulta no simulada: ${texto}`));
  });
  const manager = { query };
  const dataSource = {
    query,
    transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
      cb(manager),
    ),
  };
  const posts = {
    findOne: jest.fn(() =>
      Promise.resolve({
        id: POST,
        employeeId: MODELO,
        caption: '',
        status: 'pendiente',
        rejectionReason: null,
        submittedAt: null,
        publishedAt: null,
        createdAt: new Date(),
        likeCount: 0,
        media: [],
      }),
    ),
  };
  const realtime = { emitToBosses: jest.fn() };
  const service =
    opciones.conRealtime === false
      ? new PostsService(dataSource as never, posts as never, {} as never)
      : new PostsService(
          dataSource as never,
          posts as never,
          {} as never,
          realtime as never,
        );
  return { service, realtime, query };
}

describe('PostsService: avisos de revision', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('enviar avisa a los dos jefes de la modelo despues de guardar', async () => {
    const { service, realtime, query } = crearEntorno({});

    await service.enviar(POST, MODELO);

    expect(realtime.emitToBosses).toHaveBeenCalledWith(['jefe-1', 'jefe-2'], {
      type: 'post_pending',
      data: { postId: POST, employeeId: MODELO, eventId: expect.any(String) },
    });
    const orden = query.mock.calls.map(([sql]) => sql.trim());
    expect(orden.findIndex((s) => s.startsWith('WITH enviado'))).toBeLessThan(
      orden.findIndex((s) => s.startsWith('SELECT jefe_id')),
    );
  });

  it('sin jefes asignados pasa la lista vacia y emitToBosses cae al canal comun', async () => {
    const { service, realtime } = crearEntorno({
      jefes: { jefe_id: null, jefe_secundario_id: null },
    });

    await service.enviar(POST, MODELO);

    expect(realtime.emitToBosses).toHaveBeenCalledWith(
      [null, null],
      expect.objectContaining({ type: 'post_pending' }),
    );
  });

  it('cada envio lleva un eventId distinto: el deduplicado push no se come el segundo', async () => {
    const { service, realtime } = crearEntorno({});

    await service.enviar(POST, MODELO);
    await service.enviar(POST, MODELO);

    const ids = realtime.emitToBosses.mock.calls.map(
      ([, evento]) => (evento as { data: { eventId: string } }).data.eventId,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it('si el envio no se aplica no avisa', async () => {
    const { service, realtime } = crearEntorno({
      enviado: false,
      status: 'pendiente',
    });

    await expect(service.enviar(POST, MODELO)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(realtime.emitToBosses).not.toHaveBeenCalled();
  });

  it('un fallo del aviso no revierte ni hace fallar el envio', async () => {
    const { service, realtime } = crearEntorno({});
    realtime.emitToBosses.mockImplementation(() => {
      throw new Error('bus caido');
    });

    await expect(service.enviar(POST, MODELO)).resolves.toMatchObject({
      id: POST,
    });
  });

  it('editar un aprobado lo devuelve a revision y avisa; editar un borrador no', async () => {
    const aprobado = crearEntorno({ status: 'aprobado' });
    await aprobado.service.editarCaption(POST, MODELO, 'nuevo');
    expect(aprobado.realtime.emitToBosses).toHaveBeenCalledTimes(1);

    const borrador = crearEntorno({ status: 'borrador' });
    await borrador.service.editarCaption(POST, MODELO, 'nuevo');
    expect(borrador.realtime.emitToBosses).not.toHaveBeenCalled();

    // Un pendiente editado sigue en la cola: ya se aviso al enviarlo.
    const pendiente = crearEntorno({ status: 'pendiente' });
    await pendiente.service.editarCaption(POST, MODELO, 'nuevo');
    expect(pendiente.realtime.emitToBosses).not.toHaveBeenCalled();
  });

  it('sin RealtimeEventsService no consulta a los jefes ni falla', async () => {
    const { service, query } = crearEntorno({ conRealtime: false });

    await service.enviar(POST, MODELO);

    expect(query.mock.calls.some(([sql]) => /jefe_id/.test(sql))).toBe(false);
  });
});
