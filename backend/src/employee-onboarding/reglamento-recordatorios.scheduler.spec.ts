import { ADVISORY_LOCKS } from '../common/scheduling/advisory-lock';
import { ReglamentoRecordatoriosScheduler } from './reglamento-recordatorios.scheduler';

describe('ReglamentoRecordatoriosScheduler', () => {
  const reglamentoWeb = {
    asignarAlPersonalSinReglamento: jest.fn(),
    recordatoriosPendientes: jest.fn(),
    enviarRecordatorio: jest.fn(),
  };
  const configService = {
    get: jest.fn((_clave: string, porDefecto: unknown) => porDefecto),
  };
  let locked = true;
  const consultas: unknown[][] = [];
  const dataSource = {
    createQueryRunner: () => ({
      connect: () => Promise.resolve(),
      release: () => Promise.resolve(),
      query: (sql: string, params: unknown[]) => {
        consultas.push(params);
        return Promise.resolve(
          sql.includes('pg_try_advisory_lock') ? [{ locked }] : [],
        );
      },
    }),
  };
  const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

  const scheduler = Object.create(
    ReglamentoRecordatoriosScheduler.prototype,
  ) as ReglamentoRecordatoriosScheduler;
  Object.assign(scheduler, {
    logger,
    configService,
    reglamentoWeb,
    dataSource,
    running: false,
  });

  const ahora = new Date('2026-11-17T18:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    consultas.length = 0;
    locked = true;
    reglamentoWeb.asignarAlPersonalSinReglamento.mockResolvedValue(0);
    reglamentoWeb.recordatoriosPendientes.mockResolvedValue([]);
    reglamentoWeb.enviarRecordatorio.mockResolvedValue(undefined);
  });

  it('usa su propia clave de lock y no la del ciclo de Telegram', async () => {
    await scheduler.run(ahora);

    expect(consultas[0]).toEqual([ADVISORY_LOCKS.onboardingWebReminders]);
    expect(ADVISORY_LOCKS.onboardingWebReminders).not.toBe(
      ADVISORY_LOCKS.onboardingReminders,
    );
  });

  it('asigna primero y recuerda con las horas configuradas', async () => {
    await scheduler.run(ahora);

    expect(reglamentoWeb.asignarAlPersonalSinReglamento).toHaveBeenCalled();
    expect(reglamentoWeb.recordatoriosPendientes).toHaveBeenCalledWith(
      ahora,
      3,
    );
  });

  it('un recordatorio que falla no frena a los demas', async () => {
    const a1 = { id: 'a1' };
    const a2 = { id: 'a2' };
    reglamentoWeb.recordatoriosPendientes.mockResolvedValue([a1, a2]);
    reglamentoWeb.enviarRecordatorio.mockRejectedValueOnce(new Error('x'));

    await scheduler.run(ahora);

    expect(reglamentoWeb.enviarRecordatorio).toHaveBeenCalledWith(a2, ahora);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('se salta el turno si otra replica tiene el lock', async () => {
    locked = false;

    await scheduler.run(ahora);

    expect(reglamentoWeb.asignarAlPersonalSinReglamento).not.toHaveBeenCalled();
  });

  it('no tumba el proceso si la base falla', async () => {
    reglamentoWeb.asignarAlPersonalSinReglamento.mockRejectedValue(
      new Error('sin base'),
    );

    await expect(scheduler.run(ahora)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
