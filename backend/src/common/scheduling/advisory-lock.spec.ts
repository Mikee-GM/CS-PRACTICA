import { ADVISORY_LOCKS, withAdvisoryLockPorClave } from './advisory-lock';

describe('withAdvisoryLockPorClave', () => {
  let runner: { connect: jest.Mock; release: jest.Mock; query: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(() => {
    runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    };
    dataSource = { createQueryRunner: jest.fn(() => runner) };
  });

  it('usa el namespace y el hash de la clave, y suelta el lock en la misma conexion', async () => {
    runner.query
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    const tarea = jest.fn().mockResolvedValue(undefined);

    const ejecutado = await withAdvisoryLockPorClave(
      dataSource as any,
      ADVISORY_LOCKS.conversationTurn,
      'conversacion-1',
      tarea,
    );

    expect(ejecutado).toBe(true);
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(runner.query.mock.calls[0]).toEqual([
      'SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked',
      [811_011, 'conversacion-1'],
    ]);
    expect(runner.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(runner.release).toHaveBeenCalled();
  });

  it('no ejecuta la tarea si el lock lo tiene otro', async () => {
    runner.query.mockResolvedValueOnce([{ locked: false }]);
    const tarea = jest.fn();

    await expect(
      withAdvisoryLockPorClave(dataSource as any, 1, 'x', tarea),
    ).resolves.toBe(false);
    expect(tarea).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('suelta el lock aunque la tarea falle', async () => {
    runner.query
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);

    await expect(
      withAdvisoryLockPorClave(dataSource as any, 1, 'x', () =>
        Promise.reject(new Error('fallo')),
      ),
    ).rejects.toThrow('fallo');
    expect(runner.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(runner.release).toHaveBeenCalled();
  });

  it('el namespace del turno no repite ninguna otra clave', () => {
    const claves = Object.values(ADVISORY_LOCKS);
    expect(new Set(claves).size).toBe(claves.length);
  });
});
