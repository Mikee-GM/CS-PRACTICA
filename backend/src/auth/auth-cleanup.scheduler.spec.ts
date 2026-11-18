import { AuthCleanupScheduler } from './auth-cleanup.scheduler';

/**
 * El barrido corre en cada replica del backend, asi que lo que se comprueba es
 * que no se pise a si mismo ni tumbe el proceso si la base falla.
 */
describe('AuthCleanupScheduler', () => {
  const authService = { purgeStaleSessions: jest.fn() };

  /*
   * Ejecuta la tarea como si esta replica hubiera ganado el advisory lock. No
   * es un jest.fn a proposito: `clearAllMocks` entre pruebas no debe poder
   * dejar al runner sin implementacion.
   */
  const dataSource = {
    createQueryRunner: () => ({
      connect: () => Promise.resolve(),
      release: () => Promise.resolve(),
      query: (sql: string) =>
        Promise.resolve(
          sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
        ),
    }),
  };

  /*
   * Se construye por nombre y no con `new`.
   *
   * Con la lista posicional, cada dependencia nueva del servicio desplazaba todos
   * los dobles y estas pruebas fallaban por un motivo ajeno a lo que probaban.
   * Los campos inicializados de la clase entran como dobles porque
   * `Object.create` no los ejecuta.
   */
  const scheduler = Object.create(
    AuthCleanupScheduler.prototype,
  ) as AuthCleanupScheduler;
  Object.assign(scheduler, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    authService,
    dataSource,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authService.purgeStaleSessions.mockResolvedValue(120);
  });

  it('barre las sesiones viejas en cada ciclo', async () => {
    await scheduler.runCycle();

    expect(authService.purgeStaleSessions).toHaveBeenCalledTimes(1);
  });

  it('no arranca un ciclo encima de otro que sigue corriendo', async () => {
    let liberar: () => void = () => undefined;
    authService.purgeStaleSessions.mockReturnValue(
      new Promise<number>((resolve) => {
        liberar = () => resolve(0);
      }),
    );

    const primero = scheduler.runCycle();
    /* El primer ciclo cede varias veces antes de llegar al borrado. */
    await new Promise((resolve) => setImmediate(resolve));

    await scheduler.runCycle();

    expect(authService.purgeStaleSessions).toHaveBeenCalledTimes(1);

    liberar();
    await primero;
  });

  it('registra el fallo sin propagarlo, para no tumbar el temporizador', async () => {
    authService.purgeStaleSessions.mockRejectedValue(new Error('sin base'));

    await expect(scheduler.runCycle()).resolves.toBeUndefined();
  });

  it('vuelve a correr despues de un ciclo fallido', async () => {
    authService.purgeStaleSessions.mockRejectedValueOnce(new Error('sin base'));

    await scheduler.runCycle();
    await scheduler.runCycle();

    expect(authService.purgeStaleSessions).toHaveBeenCalledTimes(2);
  });
});
