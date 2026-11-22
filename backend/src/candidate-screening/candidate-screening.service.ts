import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, Not, QueryFailedError, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { Usuarios } from '../users/entities/user.entity';
import {
  CreateCandidateScreeningDto,
  CreateScreeningQuestionDto,
  ReorderScreeningQuestionsDto,
  ResponderEvaluacionDto,
  UpdateScreeningQuestionDto,
} from './dto/candidate-screening.dto';
import {
  CandidateScreening,
  CandidateScreeningStatus,
} from './entities/candidate-screening.entity';
import { CandidateScreeningAnswer } from './entities/candidate-screening-answer.entity';
import { ScreeningQuestion } from './entities/screening-question.entity';

@Injectable()
export class CandidateScreeningService {
  private readonly logger = new Logger(CandidateScreeningService.name);

  constructor(
    @InjectRepository(ScreeningQuestion)
    private readonly questions: Repository<ScreeningQuestion>,
    @InjectRepository(CandidateScreening)
    private readonly screenings: Repository<CandidateScreening>,
    @InjectRepository(CandidateScreeningAnswer)
    private readonly answers: Repository<CandidateScreeningAnswer>,
    @InjectRepository(Usuarios)
    private readonly usuarios: Repository<Usuarios>,
    private readonly realtime: RealtimeEventsService,
    private readonly notificaciones: NotificationsService,
  ) {}

  // ---------- Banco de preguntas ----------

  listQuestions() {
    return this.questions.find({ order: { order: 'ASC', createdAt: 'ASC' } });
  }

  async createQuestion(dto: CreateScreeningQuestionDto) {
    const maxOrder = await this.questions
      .createQueryBuilder('q')
      .select('MAX(q.order)', 'max')
      .getRawOne<{ max: number | null }>();
    return this.questions.save(
      this.questions.create({
        text: dto.text.trim(),
        order: (maxOrder?.max ?? 0) + 1,
        options: dto.options || [],
      }),
    );
  }

  async updateQuestion(id: string, dto: UpdateScreeningQuestionDto) {
    const question = await this.questions.findOneBy({ id });
    if (!question) throw new NotFoundException('Pregunta no encontrada');
    if (dto.text !== undefined) question.text = dto.text.trim();
    if (dto.active !== undefined) question.active = dto.active;
    if (dto.options !== undefined) question.options = dto.options;
    return this.questions.save(question);
  }

  async deleteQuestion(id: string) {
    const question = await this.questions.findOneBy({ id });
    if (!question) throw new NotFoundException('Pregunta no encontrada');
    await this.questions.remove(question);
    return { deleted: true };
  }

  async reorderQuestions(dto: ReorderScreeningQuestionsDto) {
    await Promise.all(
      dto.questionIds.map((id, index) =>
        this.questions.update({ id }, { order: index + 1 }),
      ),
    );
    return this.listQuestions();
  }

  // ---------- Evaluaciones de candidatas ----------

  async listScreenings(status?: CandidateScreening['status']) {
    return this.screenings.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async getScreeningDetail(id: string) {
    const screening = await this.screenings.findOne({
      where: { id },
      relations: { createdBy: true, promotedEmployee: true, answers: true },
    });
    if (!screening) throw new NotFoundException('Evaluación no encontrada');
    screening.answers?.sort(
      (a, b) =>
        new Date(a.answeredAt).getTime() - new Date(b.answeredAt).getTime(),
    );
    return screening;
  }

  async createScreening(
    dto: CreateCandidateScreeningDto,
    createdByUserId: string,
  ) {
    const questions = await this.questions.findBy({ id: In(dto.questionIds) });
    if (questions.length !== dto.questionIds.length) {
      throw new BadRequestException(
        'Alguna de las preguntas seleccionadas ya no existe',
      );
    }
    const token = randomBytes(9).toString('base64url');
    return this.screenings.save(
      this.screenings.create({
        candidateName: dto.candidateName.trim(),
        candidatePhone: dto.candidatePhone?.trim() || null,
        token,
        status: 'pendiente',
        questionIds: dto.questionIds,
        createdByUserId,
      }),
    );
  }

  async markPromoted(id: string, employeeId: string) {
    const screening = await this.screenings.findOneBy({ id });
    if (!screening) throw new NotFoundException('Evaluación no encontrada');
    screening.promotedEmployeeId = employeeId;
    return this.screenings.save(screening);
  }

  /** Regresa la siguiente pregunta sin responder, o null si ya se contestaron todas. */
  async getNextQuestion(screeningId: string) {
    const screening = await this.screenings.findOneBy({ id: screeningId });
    if (!screening) throw new NotFoundException('Evaluación no encontrada');
    const answered = await this.answers.find({
      where: { screeningId },
      select: { questionId: true },
    });
    const answeredIds = new Set(answered.map((a) => a.questionId));
    const nextId = screening.questionIds.find((id) => !answeredIds.has(id));
    if (!nextId) return null;
    const question = await this.questions.findOneBy({ id: nextId });
    if (!question) throw new NotFoundException('Pregunta no encontrada');
    return {
      question,
      index: answeredIds.size + 1,
      total: screening.questionIds.length,
    };
  }

  async submitAnswer(screeningId: string, answerText: string) {
    const screening = await this.screenings.findOneBy({ id: screeningId });
    if (!screening) throw new NotFoundException('Evaluación no encontrada');
    if (screening.status === 'completado') {
      throw new ConflictException('Esta evaluación ya fue completada');
    }
    const next = await this.getNextQuestion(screeningId);
    if (!next) throw new ConflictException('No quedan preguntas por responder');

    return this.registrarRespuesta(screening, next.question, answerText);
  }

  // ---------- Flujo web publico (sin sesion, por token) ----------

  /**
   * Lo que ve la candidata al abrir su enlace.
   *
   * Es una lectura pura: no marca la evaluacion como iniciada. Los enlaces se
   * comparten por mensajeria y la vista previa del enlace hace un GET; si eso
   * contara como inicio, el admin veria "en progreso" a quien nunca lo abrio.
   */
  async evaluacionPublica(token: string): Promise<EvaluacionPublica> {
    const screening = await this.buscarPorTokenPublico(token);
    if (screening.status === 'completado') {
      return {
        nombre: screening.candidateName,
        estado: 'completado',
        pregunta: null,
      };
    }
    const next = await this.getNextQuestion(screening.id);
    return {
      nombre: screening.candidateName,
      estado: screening.status,
      pregunta: next ? preguntaParaCandidata(next) : null,
    };
  }

  async responderPublica(
    token: string,
    dto: ResponderEvaluacionDto,
  ): Promise<AvanceDeCandidata> {
    const screening = await this.buscarPorTokenPublico(token);
    if (screening.status === 'completado') {
      throw new ConflictException('Esta evaluación ya fue completada');
    }
    const next = await this.getNextQuestion(screening.id);
    if (!next) throw new ConflictException('No quedan preguntas por responder');
    if (next.question.id !== dto.preguntaId) {
      throw new ConflictException(
        'Esa pregunta ya fue respondida. Recarga la evaluación para continuar.',
      );
    }

    const answerText = respuestaElegida(next.question, dto);

    // No hay vinculo que marque el inicio: lo marca la primera respuesta.
    // Condicionado a `pendiente` para no pisar el `startedAt` de una respuesta
    // simultanea.
    if (screening.status === 'pendiente') {
      await this.screenings.update(
        { id: screening.id, status: 'pendiente' },
        { status: 'en_progreso', startedAt: new Date() },
      );
    }

    const result = await this.registrarRespuesta(
      screening,
      next.question,
      answerText,
    );
    if (result.completed) return { completado: true };
    return {
      completado: false,
      pregunta: preguntaParaCandidata(result.question),
    };
  }

  /**
   * Guarda la respuesta y, si era la ultima, cierra la evaluacion y avisa.
   *
   * Cierra y avisa en un solo sitio, sea cual sea la respuesta que cierra.
   */
  private async registrarRespuesta(
    screening: CandidateScreening,
    question: ScreeningQuestion,
    answerText: string,
  ) {
    try {
      await this.answers.save(
        this.answers.create({
          screeningId: screening.id,
          questionId: question.id,
          questionText: question.text,
          answerText: answerText.trim().slice(0, 4000),
        }),
      );
    } catch (error) {
      // El indice unico (evaluacion, pregunta) decide entre dos envios
      // simultaneos de la misma pregunta: el segundo llega aqui.
      if (esViolacionDeUnicidad(error)) {
        throw new ConflictException('Esa pregunta ya fue respondida');
      }
      throw error;
    }

    const remaining = await this.getNextQuestion(screening.id);
    if (remaining) {
      return { completed: false as const, question: remaining };
    }

    // Condicionado a que no estuviera completada: solo la llamada que la cierra
    // avisa, aunque dos lleguen a la vez a este punto.
    const cierre = await this.screenings.update(
      { id: screening.id, status: Not('completado') },
      { status: 'completado', completedAt: new Date() },
    );
    if (cierre.affected) {
      this.realtime.emitToJefes({
        type: 'candidate_screening.completed',
        screeningId: screening.id,
        candidateName: screening.candidateName,
      });
      await this.avisarAdminsDeEvaluacionCompletada(screening.id);
    }
    return { completed: true as const };
  }

  /**
   * Push a cada admin activo. El texto no lleva el nombre de la candidata: el
   * aviso se lee en la pantalla de bloqueo y las respuestas viven detras del
   * toque, donde ya hay sesion. Solo admins porque `/admin/candidatas` es solo
   * suyo.
   */
  private async avisarAdminsDeEvaluacionCompletada(
    screeningId: string,
  ): Promise<void> {
    try {
      const admins = await this.usuarios.find({
        where: { rol: 'admin', activo: true },
        select: { id: true },
      });
      await Promise.allSettled(
        admins.map((admin) =>
          this.notificaciones.notificar(admin.id, {
            titulo: 'Evaluación de candidata completada',
            cuerpo: 'Toca para revisar sus respuestas.',
            url: `/admin/candidatas/${screeningId}`,
            tag: `candidata-${screeningId}`,
            relatedEntityId: screeningId,
            dedupeKey: `candidate_screening:completed:${screeningId}`,
          }),
        ),
      );
    } catch (error) {
      // La evaluacion ya quedo cerrada y visible en el panel; un aviso perdido
      // no justifica devolverle un error a la candidata.
      this.logger.warn(
        `No se pudo avisar a administracion de la evaluacion ${screeningId}: ${String(error)}`,
      );
    }
  }

  /**
   * El enlace publico es la unica credencial de la candidata. Un token con
   * forma imposible se descarta sin consultar, y cualquier fallo responde el
   * mismo 404 para no distinguir entre "no existe" y "mal escrito".
   */
  private async buscarPorTokenPublico(
    token: string,
  ): Promise<CandidateScreening> {
    const screening = FORMATO_DE_TOKEN.test(token)
      ? await this.screenings.findOne({
          where: { token },
          select: {
            id: true,
            candidateName: true,
            status: true,
            questionIds: true,
          },
        })
      : null;
    if (!screening) {
      throw new NotFoundException('Este enlace de evaluación no es válido');
    }
    return screening;
  }
}

/** Mismo alfabeto que genera `createScreening` (base64url). */
const FORMATO_DE_TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

const LARGO_MINIMO_DE_RESPUESTA = 2;

export type PreguntaDeCandidata = {
  id: string;
  texto: string;
  /** Posicion dentro de la evaluacion, empezando en 1. */
  numero: number;
  total: number;
  /** Vacio cuando la pregunta se contesta por escrito. */
  opciones: { indice: number; texto: string }[];
};

export type EvaluacionPublica = {
  nombre: string;
  estado: CandidateScreeningStatus;
  pregunta: PreguntaDeCandidata | null;
};

export type AvanceDeCandidata =
  { completado: false; pregunta: PreguntaDeCandidata } | { completado: true };

/**
 * Lista cerrada copiada campo por campo: las opciones del banco traen
 * `isCorrect`, y la candidata no debe ver cual es la respuesta esperada.
 */
function preguntaParaCandidata(next: {
  question: ScreeningQuestion;
  index: number;
  total: number;
}): PreguntaDeCandidata {
  return {
    id: next.question.id,
    texto: next.question.text,
    numero: next.index,
    total: next.total,
    opciones: (next.question.options ?? []).map((opcion, indice) => ({
      indice,
      texto: opcion.text,
    })),
  };
}

/**
 * Traduce lo que mando la candidata al texto que se guarda: en una pregunta con opciones se guarda el texto de la opcion elegida.
 */
function respuestaElegida(
  question: ScreeningQuestion,
  dto: ResponderEvaluacionDto,
): string {
  const opciones = question.options ?? [];
  if (opciones.length > 0) {
    const elegida = dto.opcion === undefined ? undefined : opciones[dto.opcion];
    if (!elegida) {
      throw new BadRequestException('Elige una de las opciones de la pregunta');
    }
    return elegida.text;
  }
  const texto = dto.texto?.trim() ?? '';
  if (texto.length < LARGO_MINIMO_DE_RESPUESTA) {
    throw new BadRequestException(
      'Tu respuesta debe tener entre 2 y 4000 caracteres',
    );
  }
  return texto;
}

function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === '23505'
  );
}
