import { Subject } from 'rxjs';
import { mientrasLaSesionValga, VigilanteDeSesion } from './sesion-vigente';

/**
 * Un flujo SSE dura horas y la sesion solo se comprobaba al conectar: cerrar
 * sesion, revocar la familia o desactivar la cuenta dejaba el flujo entregando
 * ubicaciones y chats a quien ya no tenia sesion.
 */
describe('mientrasLaSesionValga', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function suscribir(estaVigente: () => Promise<boolean>) {
    const fuente = new Subject<string>();
    const recibidos: string[] = [];
    let completado = false;
    mientrasLaSesionValga(fuente, estaVigente, 1000).subscribe({
      next: (v) => recibidos.push(v),
      complete: () => {
        completado = true;
      },
    });
    return { fuente, recibidos, completado: () => completado };
  }

  it('entrega los eventos mientras la sesion vale', async () => {
    const { fuente, recibidos, completado } = suscribir(() =>
      Promise.resolve(true),
    );

    fuente.next('a');
    await jest.advanceTimersByTimeAsync(3000);
    fuente.next('b');

    expect(recibidos).toEqual(['a', 'b']);
    expect(completado()).toBe(false);
  });

  it('cierra el flujo en cuanto la sesion deja de valer y ya no entrega mas', async () => {
    let vigente = true;
    const { fuente, recibidos, completado } = suscribir(() =>
      Promise.resolve(vigente),
    );

    fuente.next('antes');
    vigente = false;
    await jest.advanceTimersByTimeAsync(1000);
    fuente.next('despues');

    expect(completado()).toBe(true);
    expect(recibidos).toEqual(['antes']);
  });

  it('un fallo al comprobar no corta el flujo', async () => {
    const { fuente, recibidos, completado } = suscribir(() =>
      Promise.reject(new Error('la base se cayo un instante')),
    );

    await jest.advanceTimersByTimeAsync(3000);
    fuente.next('sigue');

    expect(completado()).toBe(false);
    expect(recibidos).toEqual(['sigue']);
  });

  it('no apila comprobaciones si una tarda mas que el intervalo', async () => {
    let enCurso = 0;
    let maximo = 0;
    const lenta = () =>
      new Promise<boolean>((resolver) => {
        enCurso += 1;
        maximo = Math.max(maximo, enCurso);
        setTimeout(() => {
          enCurso -= 1;
          resolver(true);
        }, 2500);
      });
    suscribir(lenta);

    await jest.advanceTimersByTimeAsync(6000);

    expect(maximo).toBe(1);
  });
});

describe('VigilanteDeSesion.estaVigente: mismas reglas que la validacion normal', () => {
  const ahora = Date.now();
  const futuro = new Date(ahora + 3600_000);
  const pasado = (ms: number) => new Date(ahora - ms);

  function crear(
    sesion: Record<string, unknown> | null,
    usuario: { id: string } | null = { id: 'u-1' },
  ) {
    const sesiones = { findOne: jest.fn().mockResolvedValue(sesion) };
    const usuarios = { findOne: jest.fn().mockResolvedValue(usuario) };
    return new VigilanteDeSesion(sesiones as any, usuarios as any);
  }

  it('vale una sesion vigente de un usuario activo', async () => {
    const v = crear({ expiresAt: futuro, revokedAt: null });
    await expect(v.estaVigente('u-1', 'sid')).resolves.toBe(true);
  });

  it('no vale si la sesion no existe', async () => {
    await expect(crear(null).estaVigente('u-1', 'sid')).resolves.toBe(false);
  });

  it('no vale si caduco', async () => {
    const v = crear({ expiresAt: pasado(1000), revokedAt: null });
    await expect(v.estaVigente('u-1', 'sid')).resolves.toBe(false);
  });

  it('no vale si esta revocada (cerrar sesion, reutilizar un token)', async () => {
    const v = crear({
      expiresAt: futuro,
      revokedAt: pasado(60_000),
      replacedBySessionId: null,
    });
    await expect(v.estaVigente('u-1', 'sid')).resolves.toBe(false);
  });

  it('tolera una rotacion reciente, y deja de valer cuando pasa la gracia', async () => {
    const reciente = crear({
      expiresAt: futuro,
      revokedAt: pasado(5_000),
      replacedBySessionId: 'nueva',
    });
    const vieja = crear({
      expiresAt: futuro,
      revokedAt: pasado(120_000),
      replacedBySessionId: 'nueva',
    });

    await expect(reciente.estaVigente('u-1', 'sid')).resolves.toBe(true);
    await expect(vieja.estaVigente('u-1', 'sid')).resolves.toBe(false);
  });

  it('no vale si el usuario esta desactivado', async () => {
    const v = crear({ expiresAt: futuro, revokedAt: null }, null);
    await expect(v.estaVigente('u-1', 'sid')).resolves.toBe(false);
  });
});
