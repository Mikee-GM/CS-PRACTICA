import { ChallengesService } from './challenges.service';

/**
 * Lo que se protege aqui es que el reto llegue a todos sus participantes.
 *
 * Los avisos de inicio y cierre salen por push al usuario de
 * cada participante, con dedupe por reto para que una pasada repetida del
 * scheduler no los duplique.
 */
describe('ChallengesService (avisos del ciclo)', () => {
  const challenges = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn() };
  const participants = { find: jest.fn(), count: jest.fn() };
  const dataSource = { query: jest.fn() };
  const realtime = { emitToJefes: jest.fn() };
  const notifications = { notificar: jest.fn() };

  const service = Object.create(
    ChallengesService.prototype,
  ) as ChallengesService;
  Object.assign(service, {
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    challenges,
    participants,
    dataSource,
    realtime,
    notifications,
  });

  const reto = (overrides: Record<string, unknown> = {}) => ({
    id: 'reto-1',
    title: 'Semana fuerte',
    participantType: 'employee',
    metric: 'services',
    status: 'scheduled',
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  });

  /*
   * La consulta que se sirve depende del SQL: nombres, usuarios o el KPI.
   * Asi el doble no depende del orden en que el servicio las lanza.
   */
  const responderConsultas = () =>
    dataSource.query.mockImplementation((sql: string) => {
      if (sql.includes('usuario_id')) {
        return Promise.resolve([
          { id: 'emp-a', usuario_id: 'user-a' },
          { id: 'emp-b', usuario_id: 'user-b' },
        ]);
      }
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve([
          { id: 'emp-a', name: 'Ana', value: '5' },
          { id: 'emp-b', name: 'Bea', value: '2' },
        ]);
      }
      return Promise.resolve([
        { id: 'emp-a', name: 'Ana' },
        { id: 'emp-b', name: 'Bea' },
      ]);
    });

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.notificar.mockResolvedValue(1);
    challenges.save.mockImplementation((valor) => Promise.resolve(valor));
    participants.find.mockResolvedValue([
      { participantId: 'emp-a' },
      { participantId: 'emp-b' },
    ]);
    responderConsultas();
  });

  it('avisa por push a cada participante cuando el reto empieza', async () => {
    const programado = reto();
    challenges.find.mockResolvedValue([programado]);
    challenges.findOneBy.mockResolvedValue(programado);

    await service.activateDueChallenges();

    expect(programado.status).toBe('active');
    expect(notifications.notificar).toHaveBeenCalledTimes(2);
    const [usuarioId, aviso] = notifications.notificar.mock.calls[0];
    expect(usuarioId).toBe('user-a');
    expect(aviso.cuerpo).toContain('Bea');
    expect(aviso.url).toBe('/empleada/portal?seccion=retos');
    expect(aviso.dedupeKey).toBe('reto-inicio:reto-1');
  });

  it('al cerrar avisa al ganador y a los demas con su lugar', async () => {
    const activo = reto({
      status: 'active',
      endsAt: new Date(Date.now() - 60_000),
    });
    challenges.find.mockResolvedValue([activo]);
    challenges.findOneBy.mockResolvedValue(activo);

    await service.finishDueChallenges();

    expect(activo.status).toBe('finished');
    const avisos = new Map(
      notifications.notificar.mock.calls.map(([id, aviso]) => [id, aviso]),
    );
    expect(avisos.get('user-a').titulo).toContain('Ganaste');
    expect(avisos.get('user-b').cuerpo).toContain('lugar 2 de 2');
    expect(avisos.get('user-b').dedupeKey).toBe('reto-fin:reto-1');
  });

  it('un aviso que falla no corta el de los demas participantes', async () => {
    const programado = reto();
    challenges.find.mockResolvedValue([programado]);
    challenges.findOneBy.mockResolvedValue(programado);
    notifications.notificar
      .mockRejectedValueOnce(new Error('push caido'))
      .mockResolvedValue(1);

    await service.activateDueChallenges();

    expect(notifications.notificar).toHaveBeenCalledTimes(2);
  });

  it('a un chofer lo manda a su portal', async () => {
    const programado = reto({ participantType: 'driver' });
    challenges.find.mockResolvedValue([programado]);
    challenges.findOneBy.mockResolvedValue(programado);

    await service.activateDueChallenges();

    const [, aviso] = notifications.notificar.mock.calls[0];
    expect(aviso.url).toBe('/chofer/portal?seccion=retos');
  });

  describe('misRetos', () => {
    const propio = (overrides: Record<string, unknown> = {}) =>
      reto({ status: 'active', ...overrides });

    beforeEach(() => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('WHERE usuario_id')) {
          return Promise.resolve([{ id: 'emp-b' }]);
        }
        return Promise.resolve([
          { id: 'emp-a', name: 'Ana', value: '5' },
          { id: 'emp-b', name: 'Bea', value: '2' },
        ]);
      });
      participants.find.mockImplementation(({ where }) =>
        Promise.resolve(
          where.participantId
            ? [{ challenge: propio() }]
            : [{ participantId: 'emp-a' }, { participantId: 'emp-b' }],
        ),
      );
    });

    it('devuelve mi posicion y el top con nombres', async () => {
      const retos = await service.misRetos({ id: 'user-b', rol: 'empleada' });

      expect(retos).toHaveLength(1);
      expect(retos[0]).toMatchObject({
        miPosicion: 2,
        miValor: 2,
        participantes: 2,
        gane: false,
      });
      expect(retos[0].top.map((t) => t.nombre)).toEqual(['Ana', 'Bea']);
      expect(retos[0].top[1].esMio).toBe(true);
    });

    it('omite terminados de hace mas de 30 dias y los programados', async () => {
      const viejo = propio({
        status: 'finished',
        finishedAt: new Date(Date.now() - 40 * 86_400_000),
      });
      const programado = propio({ status: 'scheduled' });
      const reciente = propio({
        id: 'reto-2',
        status: 'finished',
        finishedAt: new Date(Date.now() - 86_400_000),
        winnerParticipantId: 'emp-b',
      });
      participants.find.mockImplementation(({ where }) =>
        Promise.resolve(
          where.participantId
            ? [viejo, programado, reciente].map((challenge) => ({ challenge }))
            : [{ participantId: 'emp-a' }, { participantId: 'emp-b' }],
        ),
      );

      const retos = await service.misRetos({ id: 'user-b', rol: 'empleada' });

      expect(retos.map((r) => r.id)).toEqual(['reto-2']);
      expect(retos[0].gane).toBe(true);
    });

    it('sin ficha de empleada devuelve lista vacia', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.misRetos({ id: 'user-x', rol: 'empleada' }),
      ).resolves.toEqual([]);
    });

    it('niega a quien no es personal', async () => {
      await expect(
        service.misRetos({ id: 'user-x', rol: 'cliente' }),
      ).rejects.toThrow('Solo el personal');
    });
  });
});
