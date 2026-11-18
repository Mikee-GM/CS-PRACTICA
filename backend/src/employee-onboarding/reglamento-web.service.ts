import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { Usuarios } from '../users/entities/user.entity';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeOnboarding } from './entities/employee-onboarding.entity';
import { EmployeeRegulation } from './entities/employee-regulation.entity';
import { QuestionnaireAnswer } from './entities/questionnaire-answer.entity';
import { QuestionnaireAttempt } from './entities/questionnaire-attempt.entity';

export type RolConReglamento = 'empleada' | 'chofer' | 'jefe';

const ROLES_CON_REGLAMENTO: readonly RolConReglamento[] = [
  'empleada',
  'chofer',
  'jefe',
];

/**
 * Recordatorios push como maximo por asignacion (decision 7 de la Fase 5).
 *
 * El reglamento no bloquea nada (decision 8), asi que insistir sin fin solo
 * acostumbra a la persona a ignorar los avisos. Uno a las pocas horas y seis
 * diarios cubren la primera semana.
 */
export const MAXIMO_DE_RECORDATORIOS = 7;

export const HORAS_ENTRE_RECORDATORIOS = 24;

/**
 * A donde lleva tocar el recordatorio: la pantalla del reglamento de cada rol
 * en el frontend. Si una ruta se renombra, este es el unico lugar que cambia.
 */
const DESTINO_POR_ROL: Record<RolConReglamento, string> = {
  empleada: '/empleada/reglamento',
  chofer: '/chofer/reglamento',
  jefe: '/jefe/reglamento',
};

export type PreguntaDelCuestionario = {
  id: string;
  texto: string;
  /** Posicion dentro del intento, empezando en 1. */
  numero: number;
  total: number;
  opciones: { id: string; texto: string }[];
};

export type MiReglamento = {
  reglamento: {
    titulo: string;
    contenido: string;
    publicadoEn: Date;
    puntajeMinimo: number;
  } | null;
  cuestionario: {
    estado: EmployeeOnboarding['status'];
    esRenovacion: boolean;
    intentos: number;
    mejorPuntaje: number;
    aprobadoEn: Date | null;
    pregunta: PreguntaDelCuestionario | null;
  } | null;
};

export type AvanceDelCuestionario =
  | { completado: false; pregunta: PreguntaDelCuestionario }
  | {
      completado: true;
      aprobado: boolean;
      puntaje: number;
      mejorPuntaje: number;
      puntajeMinimo: number;
      correctas: number;
      total: number;
      intentos: number;
    };

/**
 * El reglamento y su cuestionario vistos por el propio trabajador en la web.
 *
 * Reutiliza la logica de `EmployeeOnboardingService` (intentos, variantes por
 * casilla, puntaje y trust score) y solo decide que se le muestra a la persona.
 * El trust score no sale nunca: ordena candidatas y es para quien asigna, no
 * para quien contesta.
 */
@Injectable()
export class ReglamentoWebService {
  constructor(
    private readonly onboarding: EmployeeOnboardingService,
    private readonly notificaciones: NotificationsService,
    @InjectRepository(Usuarios)
    private readonly usuarios: Repository<Usuarios>,
    @InjectRepository(EmployeeRegulation)
    private readonly reglamentos: Repository<EmployeeRegulation>,
    @InjectRepository(EmployeeOnboarding)
    private readonly asignaciones: Repository<EmployeeOnboarding>,
    @InjectRepository(QuestionnaireAttempt)
    private readonly intentos: Repository<QuestionnaireAttempt>,
    @InjectRepository(QuestionnaireAnswer)
    private readonly respuestas: Repository<QuestionnaireAnswer>,
  ) {}

  /**
   * Reglamento vigente del rol y el estado del cuestionario propio.
   *
   * Si la persona aun no tenia asignacion (personal dado de alta despues de la
   * ultima publicacion, que antes la recibia al vincular Telegram), se crea
   * aqui. Sin reglamento publicado para su rol responde vacio y no 404: no
   * tener reglamento no es un error de quien lo consulta.
   */
  async miReglamento(usuarioId: string): Promise<MiReglamento> {
    const rol = await this.rolDe(usuarioId);
    const reglamento = await this.reglamentos.findOne({
      where: { targetRole: rol },
      order: { updatedAt: 'DESC' },
    });
    if (!reglamento) return { reglamento: null, cuestionario: null };

    const asignacion =
      await this.onboarding.ensureCurrentAssignmentForUser(usuarioId);
    const pregunta =
      asignacion.status === 'in_progress'
        ? await this.preguntaEnCurso(asignacion.id)
        : null;

    return {
      reglamento: {
        titulo: reglamento.title,
        contenido: reglamento.content,
        publicadoEn: reglamento.publishedAt,
        puntajeMinimo: reglamento.passingScore,
      },
      cuestionario: {
        estado: asignacion.status,
        esRenovacion: asignacion.isRenewal,
        intentos: asignacion.attemptCount,
        mejorPuntaje: asignacion.bestScore,
        aprobadoEn: asignacion.completedAt,
        pregunta,
      },
    };
  }

  /**
   * Empieza un intento o retoma el que quedo abierto. Llamarlo dos veces no
   * abre dos intentos: `startQuestionnaire` devuelve el que ya esta en curso.
   */
  async empezar(usuarioId: string): Promise<AvanceDelCuestionario> {
    await this.rolDe(usuarioId);
    const asignacion =
      await this.onboarding.ensureCurrentAssignmentForUser(usuarioId);
    await this.onboarding.startQuestionnaire(usuarioId);
    return {
      completado: false,
      pregunta: await this.preguntaObligatoria(asignacion.id),
    };
  }

  async responder(
    usuarioId: string,
    opcionId: string,
  ): Promise<AvanceDelCuestionario> {
    await this.rolDe(usuarioId);
    const avance = await this.onboarding.submitAnswer(usuarioId, opcionId);
    if (avance.completed) {
      // Lista cerrada copiada campo por campo: `trustScore` viene en el avance y
      // no debe llegar al trabajador.
      return {
        completado: true,
        aprobado: avance.passed ?? false,
        puntaje: avance.score ?? 0,
        mejorPuntaje: avance.bestScore ?? 0,
        puntajeMinimo: avance.passingScore ?? 0,
        correctas: avance.correctAnswers ?? 0,
        total: avance.totalQuestions ?? 0,
        intentos: avance.attemptCount ?? 0,
      };
    }
    const asignacion = await this.asignaciones.findOne({
      where: { userId: usuarioId, active: true },
      select: { id: true },
    });
    if (!asignacion) throw new NotFoundException('Incorporación no encontrada');
    return {
      completado: false,
      pregunta: await this.preguntaObligatoria(asignacion.id),
    };
  }

  /**
   * Crea la asignacion al personal activo que no tiene ninguna y cuyo rol ya
   * tiene reglamento.
   *
   * Antes la asignacion nacia al vincular Telegram. Sin este paso, quien se da
   * de alta despues de la ultima publicacion y nunca abre la web no tendria
   * asignacion y por tanto nunca recibiria el recordatorio.
   *
   * @returns cuantas asignaciones se crearon.
   */
  async asignarAlPersonalSinReglamento(limite = 50): Promise<number> {
    // Los dos enum son tipos distintos en Postgres; se comparan como texto.
    const filas: Array<{ id: string }> = await this.usuarios.query(
      `SELECT u.id
         FROM usuarios u
        WHERE u.rol::text = ANY($1::text[])
          AND u.activo = true
          AND EXISTS (SELECT 1 FROM employee_regulations r
                       WHERE r.target_role::text = u.rol::text)
          AND NOT EXISTS (SELECT 1 FROM employee_onboardings o
                           WHERE o.user_id = u.id AND o.active = true)
        ORDER BY u.created_at ASC
        LIMIT $2`,
      [ROLES_CON_REGLAMENTO, limite],
    );
    let creadas = 0;
    for (const fila of filas) {
      try {
        await this.onboarding.ensureCurrentAssignmentForUser(fila.id);
        creadas += 1;
      } catch {
        // La unica carrera posible es que la persona abriera la web a la vez y
        // el indice unico de asignacion activa rechazara la segunda: ya tiene
        // la suya. Cualquier otro fallo se reintenta en el ciclo siguiente.
      }
    }
    return creadas;
  }

  /**
   * Asignaciones que deben recibir recordatorio ahora.
   *
   * El primero sale `primeraTrasHoras` despues de asignar, que en la web es
   * cuando el reglamento queda visible; los siguientes, uno cada
   * `HORAS_ENTRE_RECORDATORIOS`, hasta `MAXIMO_DE_RECORDATORIOS`. Se recuerda
   * tambien a quien dejo un intento a medias o reprobo: sigue sin aprobar.
   */
  recordatoriosPendientes(
    ahora: Date,
    primeraTrasHoras: number,
    limite = 50,
  ): Promise<EmployeeOnboarding[]> {
    const primera = new Date(ahora.getTime() - primeraTrasHoras * 3_600_000);
    const siguiente = new Date(
      ahora.getTime() - HORAS_ENTRE_RECORDATORIOS * 3_600_000,
    );
    return this.asignaciones
      .createQueryBuilder('onboarding')
      .innerJoinAndSelect('onboarding.user', 'user')
      .where('onboarding.active = true')
      .andWhere("onboarding.status <> 'completed'")
      .andWhere('user.activo = true')
      .andWhere('user.rol IN (:...roles)', { roles: ROLES_CON_REGLAMENTO })
      .andWhere('onboarding.webReminderCount < :maximo', {
        maximo: MAXIMO_DE_RECORDATORIOS,
      })
      .andWhere(
        `((onboarding.webReminderCount = 0 AND onboarding.assignedAt <= :primera)
          OR (onboarding.webReminderCount > 0 AND onboarding.lastWebReminderAt <= :siguiente))`,
        { primera, siguiente },
      )
      .orderBy('onboarding.assignedAt', 'ASC')
      .take(limite)
      .getMany();
  }

  /**
   * Manda el recordatorio y lo cuenta.
   *
   * Primero el aviso y despues el contador: la clave de dedupe lleva el numero
   * de recordatorio, asi que si el contador no llega a guardarse el ciclo
   * siguiente repite el aviso, `NotificationsService` lo descarta como
   * duplicado y solo entonces se cuenta. Al reves, un fallo al avisar gastaria
   * un recordatorio que nadie recibio.
   *
   * Se cuenta aunque la persona no tenga dispositivos: el tope es de intentos,
   * no de entregas, y sin el contaria para siempre.
   */
  async enviarRecordatorio(
    asignacion: EmployeeOnboarding,
    ahora: Date,
  ): Promise<void> {
    const numero = asignacion.webReminderCount + 1;
    const rol = asignacion.user.rol as RolConReglamento;
    await this.notificaciones.notificar(asignacion.userId, {
      titulo: asignacion.isRenewal
        ? 'Reglamento actualizado'
        : 'Reglamento pendiente',
      // Sin contenido del reglamento ni puntajes: el aviso se ve en la
      // pantalla de bloqueo.
      cuerpo: 'Tienes pendiente el cuestionario del reglamento.',
      url: DESTINO_POR_ROL[rol] ?? '/',
      tag: `reglamento-${asignacion.id}`,
      relatedEntityId: asignacion.id,
      dedupeKey: `onboarding:recordatorio:${asignacion.id}:${numero}`,
    });
    await this.asignaciones.update(
      { id: asignacion.id },
      { webReminderCount: numero, lastWebReminderAt: ahora },
    );
  }

  private async rolDe(usuarioId: string): Promise<RolConReglamento> {
    const usuario = await this.usuarios.findOne({
      where: { id: usuarioId },
      select: { id: true, rol: true },
    });
    if (
      !usuario ||
      !ROLES_CON_REGLAMENTO.includes(usuario.rol as RolConReglamento)
    ) {
      throw new NotFoundException('No se encontró un trabajador elegible');
    }
    return usuario.rol as RolConReglamento;
  }

  private async preguntaObligatoria(
    asignacionId: string,
  ): Promise<PreguntaDelCuestionario> {
    const pregunta = await this.preguntaEnCurso(asignacionId);
    if (!pregunta) {
      throw new NotFoundException('No hay un cuestionario en progreso');
    }
    return pregunta;
  }

  /**
   * Pregunta pendiente del intento abierto, con su posicion. Las opciones
   * llegan sin `isCorrect` porque la columna no se selecciona por defecto.
   */
  private async preguntaEnCurso(
    asignacionId: string,
  ): Promise<PreguntaDelCuestionario | null> {
    const intento = await this.intentos.findOne({
      where: { onboardingId: asignacionId, status: 'in_progress' },
      order: { attemptNumber: 'DESC' },
    });
    if (!intento) return null;
    const [respondidas, pregunta] = await Promise.all([
      this.respuestas.count({ where: { attemptId: intento.id } }),
      this.onboarding.getNextQuestion(intento.id),
    ]);
    return {
      id: pregunta.id,
      texto: pregunta.text,
      numero: respondidas + 1,
      total: intento.totalQuestions,
      opciones: (pregunta.options ?? []).map((opcion) => ({
        id: opcion.id,
        texto: opcion.text,
      })),
    };
  }
}
