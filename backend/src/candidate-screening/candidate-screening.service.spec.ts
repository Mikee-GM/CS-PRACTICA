import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { CandidateScreeningService } from './candidate-screening.service';

describe('CandidateScreeningService (flujo web publico)', () => {
  const TOKEN = 'AbCdEfGh_123';
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';

  const questions = { findOneBy: jest.fn() };
  const screenings = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
  };
  const answers = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((datos: unknown) => datos),
  };
  const usuarios = { find: jest.fn() };
  const realtime = { emitToJefes: jest.fn() };
  const notificaciones = { notificar: jest.fn() };

  /*
   * Se construye por nombre y no con `new`, como en el resto de modulos: una
   * dependencia nueva no desplaza los dobles.
   */
  const service = Object.create(
    CandidateScreeningService.prototype,
  ) as CandidateScreeningService;
  Object.assign(service, {
    logger: { warn: jest.fn() },
    questions,
    screenings,
    answers,
    usuarios,
    realtime,
    notificaciones,
  });

  const conOpciones = {
    id: P1,
    text: 'Disponibilidad',
    options: [
      { text: 'Fines de semana', isCorrect: true },
      { text: 'Entre semana', isCorrect: false },
    ],
  };
  const abierta = { id: P2, text: 'Cuentanos de ti', options: [] };

  let evaluacion: {
    id: string;
    candidateName: string;
    status: 'pendiente' | 'en_progreso' | 'completado';
    questionIds: string[];
  };
  let respondidas: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    evaluacion = {
      id: 'e1',
      candidateName: 'Laura',
      status: 'pendiente',
      questionIds: [P1, P2],
    };
    respondidas = [];
    screenings.findOne.mockImplementation(() => Promise.resolve(evaluacion));
    screenings.findOneBy.mockImplementation(() => Promise.resolve(evaluacion));
    screenings.update.mockResolvedValue({ affected: 1 });
    answers.find.mockImplementation(() =>
      Promise.resolve(respondidas.map((questionId) => ({ questionId }))),
    );
    answers.save.mockImplementation((fila: { questionId: string }) => {
      respondidas.push(fila.questionId);
      return Promise.resolve(fila);
    });
    questions.findOneBy.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(id === P1 ? conOpciones : abierta),
    );
    usuarios.find.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    notificaciones.notificar.mockResolvedValue(1);
  });

  describe('evaluacionPublica', () => {
    it('descarta sin consultar un token con forma imposible', async () => {
      await expect(service.evaluacionPublica('../../x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(screenings.findOne).not.toHaveBeenCalled();
    });

    it('responde 404 a un token que no existe', async () => {
      screenings.findOne.mockResolvedValue(null);

      await expect(service.evaluacionPublica(TOKEN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('muestra la pregunta en curso sin revelar la respuesta correcta', async () => {
      const vista = await service.evaluacionPublica(TOKEN);

      expect(vista).toEqual({
        nombre: 'Laura',
        estado: 'pendiente',
        pregunta: {
          id: P1,
          texto: 'Disponibilidad',
          numero: 1,
          total: 2,
          opciones: [
            { indice: 0, texto: 'Fines de semana' },
            { indice: 1, texto: 'Entre semana' },
          ],
        },
      });
      expect(JSON.stringify(vista)).not.toContain('isCorrect');
    });

    it('no marca la evaluacion como iniciada al solo abrir el enlace', async () => {
      await service.evaluacionPublica(TOKEN);

      expect(screenings.update).not.toHaveBeenCalled();
    });

    it('una evaluacion completada ya no ofrece pregunta', async () => {
      evaluacion.status = 'completado';

      await expect(service.evaluacionPublica(TOKEN)).resolves.toEqual({
        nombre: 'Laura',
        estado: 'completado',
        pregunta: null,
      });
      expect(answers.find).not.toHaveBeenCalled();
    });
  });

  describe('responderPublica', () => {
    it('guarda el texto de la opcion elegida y marca el inicio', async () => {
      const avance = await service.responderPublica(TOKEN, {
        preguntaId: P1,
        opcion: 1,
      });

      expect(answers.save).toHaveBeenCalledWith(
        expect.objectContaining({
          screeningId: 'e1',
          questionId: P1,
          questionText: 'Disponibilidad',
          answerText: 'Entre semana',
        }),
      );
      expect(screenings.update).toHaveBeenCalledWith(
        { id: 'e1', status: 'pendiente' },
        expect.objectContaining({ status: 'en_progreso' }),
      );
      expect(avance).toEqual({
        completado: false,
        pregunta: {
          id: P2,
          texto: 'Cuentanos de ti',
          numero: 2,
          total: 2,
          opciones: [],
        },
      });
    });

    it('no vuelve a marcar el inicio de una evaluacion ya en progreso', async () => {
      evaluacion.status = 'en_progreso';

      await service.responderPublica(TOKEN, { preguntaId: P1, opcion: 0 });

      expect(screenings.update).not.toHaveBeenCalled();
    });

    it('rechaza una opcion fuera de rango sin guardar', async () => {
      await expect(
        service.responderPublica(TOKEN, { preguntaId: P1, opcion: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(answers.save).not.toHaveBeenCalled();
    });

    it('exige opcion en una pregunta con opciones aunque llegue texto', async () => {
      await expect(
        service.responderPublica(TOKEN, { preguntaId: P1, texto: 'Hola' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una respuesta escrita demasiado corta', async () => {
      respondidas = [P1];
      evaluacion.status = 'en_progreso';

      await expect(
        service.responderPublica(TOKEN, { preguntaId: P2, texto: '  a ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(answers.save).not.toHaveBeenCalled();
    });

    it('rechaza responder una pregunta que ya no es la pendiente', async () => {
      respondidas = [P1];
      evaluacion.status = 'en_progreso';

      // Doble envio de la primera: no debe guardarse como respuesta de la segunda.
      await expect(
        service.responderPublica(TOKEN, { preguntaId: P1, opcion: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(answers.save).not.toHaveBeenCalled();
    });

    it('rechaza responder una evaluacion completada', async () => {
      evaluacion.status = 'completado';

      await expect(
        service.responderPublica(TOKEN, { preguntaId: P1, opcion: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(answers.save).not.toHaveBeenCalled();
    });

    it('traduce el choque del indice unico en un 409', async () => {
      const choque = new QueryFailedError('INSERT', [], new Error('dup'));
      (choque as QueryFailedError & { code: string }).code = '23505';
      answers.save.mockRejectedValue(choque);

      await expect(
        service.responderPublica(TOKEN, { preguntaId: P1, opcion: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('la ultima respuesta cierra la evaluacion y avisa a jefes y admins', async () => {
      respondidas = [P1];
      evaluacion.status = 'en_progreso';

      const avance = await service.responderPublica(TOKEN, {
        preguntaId: P2,
        texto: '  Tengo experiencia  ',
      });

      expect(avance).toEqual({ completado: true });
      expect(answers.save).toHaveBeenCalledWith(
        expect.objectContaining({ answerText: 'Tengo experiencia' }),
      );
      expect(screenings.update).toHaveBeenCalledWith(
        { id: 'e1', status: Not('completado') },
        expect.objectContaining({ status: 'completado' }),
      );
      expect(realtime.emitToJefes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'candidate_screening.completed',
          screeningId: 'e1',
        }),
      );
      expect(usuarios.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { rol: 'admin', activo: true } }),
      );
      expect(notificaciones.notificar).toHaveBeenCalledTimes(2);
      const [, aviso] = notificaciones.notificar.mock.calls[0] as [
        string,
        { url: string; cuerpo: string; titulo: string; dedupeKey: string },
      ];
      expect(aviso.url).toBe('/admin/candidatas/e1');
      expect(aviso.dedupeKey).toBe('candidate_screening:completed:e1');
      // Se lee en la pantalla de bloqueo: sin el nombre de la candidata.
      expect(`${aviso.titulo} ${aviso.cuerpo}`).not.toContain('Laura');
    });

    it('si otra llamada ya la cerro, no repite los avisos', async () => {
      respondidas = [P1];
      evaluacion.status = 'en_progreso';
      screenings.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.responderPublica(TOKEN, { preguntaId: P2, texto: 'Hola, soy' }),
      ).resolves.toEqual({ completado: true });
      expect(realtime.emitToJefes).not.toHaveBeenCalled();
      expect(notificaciones.notificar).not.toHaveBeenCalled();
    });

    it('un fallo al buscar admins no le devuelve error a la candidata', async () => {
      respondidas = [P1];
      evaluacion.status = 'en_progreso';
      usuarios.find.mockRejectedValue(new Error('sin conexion'));

      await expect(
        service.responderPublica(TOKEN, { preguntaId: P2, texto: 'Hola, soy' }),
      ).resolves.toEqual({ completado: true });
    });
  });

  describe('submitAnswer', () => {
    it('sigue cerrando y avisando por el mismo camino', async () => {
      respondidas = [P1];
      evaluacion.status = 'en_progreso';

      await expect(service.submitAnswer('e1', 'Respuesta')).resolves.toEqual({
        completed: true,
      });
      expect(realtime.emitToJefes).toHaveBeenCalled();
      expect(notificaciones.notificar).toHaveBeenCalledTimes(2);
    });
  });
});
