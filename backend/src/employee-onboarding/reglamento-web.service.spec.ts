import { NotFoundException } from '@nestjs/common';
import {
  MAXIMO_DE_RECORDATORIOS,
  ReglamentoWebService,
} from './reglamento-web.service';

describe('ReglamentoWebService', () => {
  const onboarding = {
    ensureCurrentAssignmentForUser: jest.fn(),
    startQuestionnaire: jest.fn(),
    submitAnswer: jest.fn(),
    getNextQuestion: jest.fn(),
  };
  const notificaciones = { notificar: jest.fn() };
  const usuarios = { findOne: jest.fn(), query: jest.fn() };
  const reglamentos = { findOne: jest.fn() };
  const asignaciones = {
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const intentos = { findOne: jest.fn() };
  const respuestas = { count: jest.fn() };

  /*
   * Se construye por nombre y no con `new`, como el resto de pruebas del
   * modulo: una dependencia nueva no desplaza los dobles.
   */
  const service = Object.create(
    ReglamentoWebService.prototype,
  ) as ReglamentoWebService;
  Object.assign(service, {
    onboarding,
    notificaciones,
    usuarios,
    reglamentos,
    asignaciones,
    intentos,
    respuestas,
  });

  const reglamento = {
    title: 'Reglamento',
    content: 'Texto del reglamento',
    publishedAt: new Date('2026-11-01T12:00:00Z'),
    passingScore: 80,
    publicationKey: 'pub-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    usuarios.findOne.mockResolvedValue({ id: 'u1', rol: 'empleada' });
    reglamentos.findOne.mockResolvedValue(reglamento);
  });

  describe('miReglamento', () => {
    it('responde vacio sin reglamento publicado y no crea asignacion', async () => {
      reglamentos.findOne.mockResolvedValue(null);

      await expect(service.miReglamento('u1')).resolves.toEqual({
        reglamento: null,
        cuestionario: null,
      });
      expect(onboarding.ensureCurrentAssignmentForUser).not.toHaveBeenCalled();
    });

    it('busca el reglamento del rol de la persona', async () => {
      usuarios.findOne.mockResolvedValue({ id: 'u1', rol: 'chofer' });
      reglamentos.findOne.mockResolvedValue(null);

      await service.miReglamento('u1');

      expect(reglamentos.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { targetRole: 'chofer' } }),
      );
    });

    it('rechaza a quien no tiene reglamento por rol', async () => {
      usuarios.findOne.mockResolvedValue({ id: 'u1', rol: 'admin' });

      await expect(service.miReglamento('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devuelve la pregunta en curso con su posicion y sin trust score', async () => {
      onboarding.ensureCurrentAssignmentForUser.mockResolvedValue({
        id: 'a1',
        status: 'in_progress',
        isRenewal: true,
        attemptCount: 2,
        bestScore: 60,
        trustScore: 2,
        completedAt: null,
      });
      intentos.findOne.mockResolvedValue({ id: 'i1', totalQuestions: 5 });
      respuestas.count.mockResolvedValue(2);
      onboarding.getNextQuestion.mockResolvedValue({
        id: 'q3',
        text: 'Pregunta tres',
        order: 3,
        options: [
          { id: 'o1', text: 'Uno', order: 1 },
          { id: 'o2', text: 'Dos', order: 2 },
        ],
      });

      const resultado = await service.miReglamento('u1');

      expect(resultado).toEqual({
        reglamento: {
          titulo: 'Reglamento',
          contenido: 'Texto del reglamento',
          publicadoEn: reglamento.publishedAt,
          puntajeMinimo: 80,
        },
        cuestionario: {
          estado: 'in_progress',
          esRenovacion: true,
          intentos: 2,
          mejorPuntaje: 60,
          aprobadoEn: null,
          pregunta: {
            id: 'q3',
            texto: 'Pregunta tres',
            numero: 3,
            total: 5,
            opciones: [
              { id: 'o1', texto: 'Uno' },
              { id: 'o2', texto: 'Dos' },
            ],
          },
        },
      });
      expect(JSON.stringify(resultado)).not.toContain('trust');
    });

    it('no busca pregunta si no hay intento abierto', async () => {
      onboarding.ensureCurrentAssignmentForUser.mockResolvedValue({
        id: 'a1',
        status: 'pending',
        isRenewal: false,
        attemptCount: 0,
        bestScore: 0,
        completedAt: null,
      });

      const resultado = await service.miReglamento('u1');

      expect(resultado.cuestionario?.pregunta).toBeNull();
      expect(intentos.findOne).not.toHaveBeenCalled();
    });
  });

  describe('responder', () => {
    it('al terminar copia el resultado sin el trust score', async () => {
      onboarding.submitAnswer.mockResolvedValue({
        completed: true,
        passed: true,
        score: 100,
        bestScore: 100,
        trustScore: 5,
        attemptCount: 1,
        passingScore: 80,
        correctAnswers: 5,
        totalQuestions: 5,
      });

      const resultado = await service.responder('u1', 'o1');

      expect(resultado).toEqual({
        completado: true,
        aprobado: true,
        puntaje: 100,
        mejorPuntaje: 100,
        puntajeMinimo: 80,
        correctas: 5,
        total: 5,
        intentos: 1,
      });
      expect(onboarding.submitAnswer).toHaveBeenCalledWith('u1', 'o1');
    });

    it('si quedan preguntas devuelve la siguiente', async () => {
      onboarding.submitAnswer.mockResolvedValue({ completed: false });
      asignaciones.findOne.mockResolvedValue({ id: 'a1' });
      intentos.findOne.mockResolvedValue({ id: 'i1', totalQuestions: 3 });
      respuestas.count.mockResolvedValue(1);
      onboarding.getNextQuestion.mockResolvedValue({
        id: 'q2',
        text: 'Dos',
        options: [],
      });

      await expect(service.responder('u1', 'o1')).resolves.toEqual({
        completado: false,
        pregunta: {
          id: 'q2',
          texto: 'Dos',
          numero: 2,
          total: 3,
          opciones: [],
        },
      });
    });
  });

  describe('empezar', () => {
    it('asegura la asignacion antes de abrir el intento', async () => {
      const orden: string[] = [];
      onboarding.ensureCurrentAssignmentForUser.mockImplementation(() => {
        orden.push('asignar');
        return Promise.resolve({ id: 'a1' });
      });
      onboarding.startQuestionnaire.mockImplementation(() => {
        orden.push('empezar');
        return Promise.resolve({ completed: false });
      });
      intentos.findOne.mockResolvedValue({ id: 'i1', totalQuestions: 2 });
      respuestas.count.mockResolvedValue(0);
      onboarding.getNextQuestion.mockResolvedValue({
        id: 'q1',
        text: 'Uno',
        options: [],
      });

      const resultado = await service.empezar('u1');

      expect(orden).toEqual(['asignar', 'empezar']);
      expect(resultado).toEqual({
        completado: false,
        pregunta: expect.objectContaining({ id: 'q1', numero: 1, total: 2 }),
      });
    });
  });

  describe('asignarAlPersonalSinReglamento', () => {
    it('sigue con el resto si una asignacion choca', async () => {
      usuarios.query.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      onboarding.ensureCurrentAssignmentForUser
        .mockRejectedValueOnce(new Error('duplicada'))
        .mockResolvedValueOnce({ id: 'a2' });

      await expect(service.asignarAlPersonalSinReglamento()).resolves.toBe(1);
      expect(onboarding.ensureCurrentAssignmentForUser).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('recordatoriosPendientes', () => {
    it('separa el primer recordatorio de los diarios y aplica el tope', async () => {
      const qb: Record<string, jest.Mock> = {};
      for (const metodo of [
        'innerJoinAndSelect',
        'where',
        'andWhere',
        'orderBy',
        'take',
      ]) {
        qb[metodo] = jest.fn().mockReturnValue(qb);
      }
      qb.getMany = jest.fn().mockResolvedValue([]);
      asignaciones.createQueryBuilder.mockReturnValue(qb);
      const ahora = new Date('2026-11-17T18:00:00Z');

      await service.recordatoriosPendientes(ahora, 3);

      const parametros = Object.assign(
        {},
        ...qb.andWhere.mock.calls.map(([, params]) => params ?? {}),
      );
      expect(parametros).toEqual(
        expect.objectContaining({
          maximo: MAXIMO_DE_RECORDATORIOS,
          primera: new Date('2026-11-17T15:00:00Z'),
          siguiente: new Date('2026-11-16T18:00:00Z'),
        }),
      );
    });
  });

  describe('enviarRecordatorio', () => {
    const asignacion = {
      id: 'a1',
      userId: 'u1',
      isRenewal: false,
      webReminderCount: 2,
      user: { rol: 'chofer' },
    } as any;
    const ahora = new Date('2026-11-17T18:00:00Z');

    it('avisa con clave por numero de recordatorio y despues lo cuenta', async () => {
      const orden: string[] = [];
      notificaciones.notificar.mockImplementation(() => {
        orden.push('avisar');
        return Promise.resolve(1);
      });
      asignaciones.update.mockImplementation(() => {
        orden.push('contar');
        return Promise.resolve();
      });

      await service.enviarRecordatorio(asignacion, ahora);

      expect(orden).toEqual(['avisar', 'contar']);
      expect(notificaciones.notificar).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          url: '/chofer/portal',
          dedupeKey: 'onboarding:recordatorio:a1:3',
        }),
      );
      expect(asignaciones.update).toHaveBeenCalledWith(
        { id: 'a1' },
        { webReminderCount: 3, lastWebReminderAt: ahora },
      );
    });

    it('no gasta un recordatorio si el aviso falla', async () => {
      notificaciones.notificar.mockRejectedValue(new Error('caido'));

      await expect(
        service.enviarRecordatorio(asignacion, ahora),
      ).rejects.toThrow('caido');
      expect(asignaciones.update).not.toHaveBeenCalled();
    });
  });
});
