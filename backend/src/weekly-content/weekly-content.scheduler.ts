import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
} from '../common/scheduling/advisory-lock';
import {
  PORTAL_FOTOS_PATH,
  WeeklyContentService,
} from './weekly-content.service';
import {
  NotificationsService,
  type Aviso,
} from '../notifications/notifications.service';
import {
  AVISO_FOTOS_SEMANALES,
  AVISO_SANCION,
} from '../notifications/avisos-catalogo';
import { WeeklyContentSchedule } from './entities/weekly-content-schedule.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { ConductReport } from '../discipline/entities/conduct-report.entity';
import { APP_LOCALE, APP_TIME_ZONE } from '../common/locale';

const FORMATO_MONEDA = new Intl.NumberFormat(APP_LOCALE, {
  style: 'currency',
  currency: 'MXN',
});

@Injectable()
export class WeeklyContentScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeeklyContentScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly weeklyContentService: WeeklyContentService,
    private readonly notifications: NotificationsService,
    @InjectRepository(WeeklyContentSchedule)
    private readonly scheduleRepo: Repository<WeeklyContentSchedule>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepo: Repository<Empleadas>,
    @InjectRepository(ConductReport)
    private readonly conductReportRepo: Repository<ConductReport>,
    private readonly dataSource: DataSource,
  ) {}

  /*
   * Arranca siempre. Antes se apagaba sin token de Telegram porque los avisos
   * solo salian por el bot; ahora salen por push, y un entorno sin bot tambien
   * tiene que pedir las fotos y cobrar la multa.
   */
  onModuleInit() {
    // Escanear cada 10 minutos
    this.timer = setInterval(() => void this.runCycle(), 10 * 60 * 1000);
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
    const initialTimer = setTimeout(() => void this.runCycle(), 10_000);
    if (typeof initialTimer?.unref === 'function') {
      initialTimer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      // Advisory lock: sin el, dos replicas pedirian las fotos y aplicarian las
      // multas del mismo ciclo por duplicado.
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.weeklyContent,
        () => this.runWeeklyCycle(),
      );
    } catch (error) {
      this.logger.error('Error en WeeklyContentScheduler:', error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Ciclo semanal de contenido.
   *
   * Viernes se piden las fotos; sabado, domingo y lunes sale un recordatorio
   * por dia; al agotarse el ultimo sin fotos se carga la multa. Los avisos se
   * cuentan dentro de la semana: el contador vuelve a cero con la solicitud del
   * viernes siguiente.
   *
   * Se manda un recordatorio por dia --y no cada N horas-- para que el aviso
   * caiga siempre a una hora en la que la modelo esta despierta.
   */
  private async runWeeklyCycle(): Promise<void> {
    const now = new Date();
    const localDate = new Date(
      now.toLocaleString('en-US', { timeZone: APP_TIME_ZONE }),
    );
    const day = localDate.getDay(); // 0 = dom, 1 = lun, 5 = vie, 6 = sab
    const hour = localDate.getHours();

    const currentFriday = this.weeklyContentService.getCurrentCycleFriday();

    // 1. VIERNES (>= 10:00): crear el ciclo y pedir las fotos.
    if (day === 5 && hour >= 10) {
      await this.handleFridayRequests(currentFriday);
    }

    // 2. SÁBADO, DOMINGO y LUNES (>= 10:00): un recordatorio por dia mientras
    //    queden avisos por gastar.
    if ([6, 0, 1].includes(day) && hour >= 10) {
      await this.handleReminders(currentFriday);
    }

    // 3. Agotados los recordatorios, la multa. Se evalua tras los avisos, pero
    //    solo dispara cuando el contador ya llego al tope, asi que el ultimo
    //    recordatorio y la multa nunca caen en la misma pasada.
    if ([0, 1, 2].includes(day) && hour >= 10) {
      await this.handleExhaustedReminders(currentFriday);
    }
  }

  /**
   * Pide las fotos a todas las modelos con catalogo activo.
   *
   * Hasta la Fase 5 se saltaba a quien no tenia Telegram vinculado, porque el
   * pedido solo viajaba por el bot. Ahora el aviso es push y el portal es la
   * via de entrega, asi que todas quedan sujetas al ciclo; la que entra por
   * primera vez tiene su semana de gracia (`esSemanaDeGracia`).
   */
  private async handleFridayRequests(semanaInicio: string) {
    const activeEmployees = await this.empleadasRepo.find({
      where: { catalogoActivo: true },
    });

    for (const emp of activeEmployees) {
      const existente = await this.scheduleRepo.findOne({
        where: { empleadaId: emp.id, semanaInicio },
      });
      if (existente) continue;

      const schedule = await this.scheduleRepo.save(
        this.scheduleRepo.create({
          empleadaId: emp.id,
          semanaInicio,
          estado: 'solicitado',
          solicitadoAt: new Date(),
          recordatoriosEnviados: 0,
        }),
      );

      await this.avisar(emp.usuarioId, {
        titulo: 'Toca renovar tus fotos de la semana',
        cuerpo:
          'Sube tus fotos recientes desde tu portal para renovar tu catalogo.',
        url: PORTAL_FOTOS_PATH,
        tag: `fotos-${schedule.id}`,
        tipo: AVISO_FOTOS_SEMANALES,
        relatedEntityId: schedule.id,
        dedupeKey: `fotos-solicitud:${schedule.id}`,
      });
    }
  }

  /**
   * Un recordatorio por dia mientras queden avisos.
   *
   * El filtro es el contador y no el estado: `recordatorio_enviado` era un
   * estado terminal que impedia mandar un segundo aviso. El estado se conserva
   * porque el resto del sistema lo lee, pero quien decide es el contador.
   */
  private async handleReminders(semanaInicio: string) {
    const { maxRecordatorios } =
      await this.weeklyContentService.getFinePolicy();

    const pendientes = await this.scheduleRepo.find({
      where: [
        { semanaInicio, estado: 'solicitado' },
        { semanaInicio, estado: 'recordatorio_enviado' },
      ],
      relations: { empleada: true },
    });

    for (const schedule of pendientes) {
      if (schedule.recordatoriosEnviados >= maxRecordatorios) continue;

      // Un solo aviso por dia: si el de hoy ya salio, se espera al siguiente.
      if (this.yaAvisadoHoy(schedule.recordatorioAt)) continue;

      const numero = schedule.recordatoriosEnviados + 1;
      const restantes = maxRecordatorios - numero;
      const gracia = await this.weeklyContentService.esSemanaDeGracia(
        schedule.empleadaId,
        semanaInicio,
      );

      /*
       * Nivel 2: tiene plazo, no urgencia. Pero se le cobra una multa si se le
       * pasa, asi que enterarse tarde le cuesta dinero.
       *
       * La clave de dedupe lleva el numero de aviso: si el guardado del
       * contador falla tras el envio, la pasada siguiente no lo repite.
       */
      await this.avisar(schedule.empleada?.usuarioId, {
        titulo: `Te faltan tus fotos de la semana (${numero} de ${maxRecordatorios})`,
        cuerpo: this.cuerpoDelRecordatorio(restantes, gracia),
        url: PORTAL_FOTOS_PATH,
        tag: `fotos-${schedule.id}`,
        tipo: AVISO_FOTOS_SEMANALES,
        relatedEntityId: schedule.id,
        dedupeKey: `fotos-recordatorio:${schedule.id}:${numero}`,
      });

      schedule.estado = 'recordatorio_enviado';
      schedule.recordatorioAt = new Date();
      schedule.recordatoriosEnviados = numero;
      await this.scheduleRepo.save(schedule);
    }
  }

  private cuerpoDelRecordatorio(restantes: number, gracia: boolean): string {
    if (gracia) {
      return restantes > 0
        ? 'Esta semana no hay multa, pero a partir de la proxima si. Subelas desde tu portal.'
        : 'Ultimo aviso. Esta semana no hay multa, pero a partir de la proxima si.';
    }
    if (restantes <= 0) {
      return 'Es el ultimo aviso: si no las subes, se aplicara la multa.';
    }
    return `Te ${restantes === 1 ? 'queda' : 'quedan'} ${restantes} ${
      restantes === 1 ? 'aviso' : 'avisos'
    } antes de que se aplique la multa.`;
  }

  /**
   * Multa a quien agoto sus avisos sin subir nada.
   *
   * Sustituye al reporte de conducta que se abria antes y se quedaba esperando
   * a que alguien lo revisara: la consecuencia ahora es inmediata y visible en
   * el corte. El reporte se sigue registrando para que quede en el historial
   * disciplinario, pero ya no es lo unico que pasa.
   *
   * En la semana de gracia el ciclo se cierra igual (`falta_aplicada`, para que
   * el ERP la vea atrasada y la pasada siguiente no la vuelva a evaluar), pero
   * sin multa ni reporte: la gracia es justamente no tener consecuencia.
   */
  private async handleExhaustedReminders(semanaInicio: string) {
    const { maxRecordatorios, importeMulta } =
      await this.weeklyContentService.getFinePolicy();

    const pendientes = await this.scheduleRepo.find({
      where: [
        { semanaInicio, estado: 'solicitado' },
        { semanaInicio, estado: 'recordatorio_enviado' },
      ],
      relations: { empleada: true },
    });

    for (const schedule of pendientes) {
      if (schedule.recordatoriosEnviados < maxRecordatorios) continue;
      if (schedule.multaAplicadaAt) continue;

      const usuarioId = schedule.empleada?.usuarioId;
      const aplicada = new Date();

      if (
        await this.weeklyContentService.esSemanaDeGracia(
          schedule.empleadaId,
          semanaInicio,
        )
      ) {
        schedule.estado = 'falta_aplicada';
        schedule.faltaAt = aplicada;
        await this.scheduleRepo.save(schedule);

        await this.avisar(usuarioId, {
          titulo: 'Esta semana no se aplico multa',
          cuerpo:
            'No recibimos tus fotos, pero era tu semana de gracia. A partir de la proxima, agotar los avisos tiene multa.',
          url: PORTAL_FOTOS_PATH,
          tag: `fotos-${schedule.id}`,
          tipo: AVISO_FOTOS_SEMANALES,
          relatedEntityId: schedule.id,
          dedupeKey: `fotos-gracia:${schedule.id}`,
        });
        continue;
      }

      schedule.estado = 'falta_aplicada';
      schedule.faltaAt = aplicada;
      schedule.multaAplicadaAt = aplicada;
      schedule.multaLiquidationRecordId = await this.registrarMulta(
        schedule.empleadaId,
        semanaInicio,
        importeMulta,
        aplicada,
      );
      await this.scheduleRepo.save(schedule);

      const registrada = Boolean(schedule.multaLiquidationRecordId);

      await this.conductReportRepo.save(
        this.conductReportRepo.create({
          direction: 'system_to_employee' as any,
          reporterType: 'employee',
          reporterId: schedule.empleadaId,
          subjectType: 'employee',
          subjectId: schedule.empleadaId,
          category: 'incumplimiento',
          description:
            `Incumplimiento de entrega de contenido semanal para el ciclo ${semanaInicio}. ` +
            `Se agotaron los ${maxRecordatorios} recordatorios` +
            (registrada ? ' y se aplico la multa correspondiente.' : '.'),
          priority: 'alta',
          status: 'en_revision',
        }),
      );

      await this.avisar(usuarioId, {
        titulo: 'Se aplico una multa por tus fotos semanales',
        cuerpo: registrada
          ? `Se cargo una multa de ${FORMATO_MONEDA.format(importeMulta)} a tu corte. Todavia puedes subirlas desde tu portal.`
          : 'Se registro el incumplimiento en tu historial. Todavia puedes subirlas desde tu portal.',
        url: PORTAL_FOTOS_PATH,
        tag: `fotos-${schedule.id}`,
        tipo: AVISO_SANCION,
        relatedEntityId: schedule.id,
        dedupeKey: `fotos-multa:${schedule.id}`,
      });
    }
  }

  /** Si ya se le aviso hoy, en hora de la operacion. */
  private yaAvisadoHoy(ultimo: Date | null): boolean {
    if (!ultimo) return false;
    const dia = (fecha: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(fecha);
    return dia(ultimo) === dia(new Date());
  }

  /**
   * Escribe la multa como registro del corte.
   *
   * `registered_by_user_id` no admite nulos y detras de una multa automatica no
   * hay ningun administrador, asi que se firma con el jefe de la modelo, que es
   * quien responde por ella, y si no tuviera, con cualquier administrador
   * activo. Sin ninguno de los dos no se registra: es preferible quedarse sin
   * multa que reventar el ciclo de todas las demas.
   */
  private async registrarMulta(
    empleadaId: string,
    semanaInicio: string,
    importe: number,
    occurredAt: Date,
  ): Promise<string | null> {
    if (importe <= 0) return null;

    try {
      const firmantes: Array<{ id: string; rol: string }> =
        await this.dataSource.query(
          `SELECT u.id, u.rol, 0 AS prioridad
             FROM empleadas e
             JOIN usuarios u
               ON u.id = COALESCE(e.jefe_id, e.jefe_secundario_id)
            WHERE e.id = $1 AND u.activo = true
            UNION ALL
           SELECT id, rol, 1 AS prioridad
             FROM usuarios
            WHERE rol = 'admin' AND activo = true
            ORDER BY prioridad
            LIMIT 1`,
          [empleadaId],
        );

      const firmante = firmantes[0];
      if (!firmante) {
        this.logger.warn(
          `Sin jefe ni administrador activo para firmar la multa de ${empleadaId}.`,
        );
        return null;
      }

      const insertadas: Array<{ id: string }> = await this.dataSource.query(
        `INSERT INTO liquidation_records
           (employee_id, registered_by_user_id, source_role, occurred_at,
            service_total, payment_method, cash_amount, card_amounts,
            company_percentage, is_fine, fine_amount, place)
         VALUES ($1, $2, $3, $4, 0, 'efectivo', 0, '[]'::jsonb, 0, true, $5, $6)
         RETURNING id`,
        [
          empleadaId,
          firmante.id,
          firmante.rol === 'admin' ? 'admin' : 'jefe',
          occurredAt,
          importe,
          `Multa: fotos semanales no entregadas (ciclo ${semanaInicio})`,
        ],
      );

      return insertadas[0]?.id ?? null;
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la multa de contenido semanal de ${empleadaId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Manda un aviso de fotos por push.
   *
   * `notificar` no lanza, pero el ciclo recorre a todas las modelos y un fallo
   * inesperado con una no puede dejar a las demas sin aviso ni sin multa.
   */
  private async avisar(
    usuarioId: string | null | undefined,
    aviso: Aviso,
  ): Promise<void> {
    if (!usuarioId) return;
    try {
      await this.notifications.notificar(usuarioId, aviso);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el aviso "${aviso.titulo}" a ${usuarioId}:`,
        error,
      );
    }
  }
}
