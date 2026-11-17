import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
} from '../common/scheduling/advisory-lock';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { Servicios } from './entities/service.entity';
import { AiMessageService } from '../ai/ai-message.service';
import { describeError } from '../common/errors/error-message';
import { APP_TIME_ZONE, APP_LOCALE } from '../common/locale';
import { ServicesService } from './services.service';
import { ConversationNotifier } from '../conversations/conversation-notifier';
import { avisarAlChatWeb, unaVez } from './aviso-al-cliente-web';
import {
  NotificationsService,
  type Aviso,
} from '../notifications/notifications.service';

@Injectable()
export class ServiceScheduleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceScheduleScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private telegramEnabled = true;

  constructor(
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @InjectBot()
    private readonly bot: Telegraf<any>,
    private readonly configService: ConfigService,
    private readonly aiMessageService: AiMessageService,
    private readonly dataSource: DataSource,
    private readonly servicesService: ServicesService,
    private readonly notifications: NotificationsService,
    // Opcional por lo mismo que en `ServicesService`: sin el no hay canal web.
    @Optional()
    private readonly conversationNotifier?: ConversationNotifier,
  ) {}

  onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
    if (
      !token ||
      token.includes('dummy') ||
      token.includes('fake') ||
      token.startsWith('123456789')
    ) {
      // Solo se apaga el envio al cliente de Telegram: el recordatorio al
      // personal sale por push y al cliente web por su chat.
      this.logger.log(
        'Bot de Telegram deshabilitado en local; el recordatorio de citas no saldra por Telegram.',
      );
      this.telegramEnabled = false;
    }
    // Check every 60 seconds
    this.timer = setInterval(() => void this.runCycle(), 60 * 1000);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
    this.initialTimer = setTimeout(() => void this.runCycle(), 10_000);
    if (typeof this.initialTimer.unref === 'function')
      this.initialTimer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  /**
   * El guard `running` evita solapes dentro del proceso; el advisory lock evita
   * que dos replicas manden el mismo recordatorio al mismo cliente.
   */
  private async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.serviceSchedule,
        () => this.checkUpcomingScheduledServices(),
      );
    } catch (error) {
      this.logger.warn(
        `Error en el ciclo de citas programadas: ${describeError(error)}`,
      );
    }
    try {
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.serviceOperations,
        async () => {
          await this.servicesService.sweepEmployeeAcceptanceDeadlines();
          await this.servicesService.sweepServicesEndingSoon();
        },
      );
    } catch (error) {
      this.logger.warn(
        `Error en el ciclo operativo de servicios: ${describeError(error)}`,
      );
    }
    try {
      /*
       * Respaldo de startWaitTimeout: cubre el plazo de espera que quedo sin
       * cancelar porque el proceso que lo inicio se reinicio o cayo antes de
       * que su propio setTimeout llegara a dispararse.
       */
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.waitTimeoutSweep,
        () => this.servicesService.sweepExpiredWaits(),
      );
    } catch (error) {
      this.logger.warn(
        `Error en el barrido de esperas vencidas: ${describeError(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async checkUpcomingScheduledServices(): Promise<void> {
    const now = Date.now();
    const alertThreshold = now + 45 * 60 * 1000; // 45 minutes from now

    const scheduledServices = await this.serviciosRepository.find({
      where: {
        estado: 'agendado',
        tipoAgenda: 'programado',
        notificacionPreviaEnviada: false,
      },
      relations: {
        cliente: true,
        empleada: true,
      },
    });

    for (const service of scheduledServices) {
      if (!service.fechaProgramada) continue;
      const appointmentTime = new Date(service.fechaProgramada).getTime();

      if (appointmentTime <= alertThreshold) {
        service.notificacionPreviaEnviada = true;
        await this.serviciosRepository.save(service);

        const horaStr = new Date(service.fechaProgramada).toLocaleTimeString(
          APP_LOCALE,
          {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: APP_TIME_ZONE,
          },
        );

        /*
         * 1 y 2. Empleada y jefe, por push. Antes iban por Telegram: un mensaje
         * directo a la modelo y otro al grupo del jefe con botones para elegir
         * transporte. El grupo con temas no se porta (Fase 5); el jefe elige el
         * transporte desde su panel. El texto no lleva nombres ni hora: el aviso
         * se ve en la pantalla de bloqueo y el detalle vive tras el toque.
         */
        await this.avisar(service.empleada?.usuarioId, {
          titulo: 'Tu cita es en 45 minutos',
          cuerpo: 'Preparate para el traslado. Toca para ver el servicio.',
          url: '/empleada/servicio',
          tag: `cita-${service.id}`,
          requireInteraction: true,
          relatedEntityId: service.id,
          dedupeKey: `employee:appointment_reminder:${service.id}:event`,
        });
        await this.avisar(service.jefeId, {
          titulo: 'Cita en 45 minutos',
          cuerpo: `Elige el transporte para iniciar el traslado (preferido: ${
            service.transporteAgendado || 'sin asignar'
          }).`,
          url: '/jefe',
          tag: `cita-${service.id}`,
          requireInteraction: true,
          relatedEntityId: service.id,
          dedupeKey: `boss:appointment_reminder:${service.id}:event`,
        });

        // 3. Notificar al Cliente mediante la IA
        const respaldoRecordatorio = `Hola amor, te confirmo que todo está listo para nuestra cita de las ${horaStr}, ya me estoy preparando.`;
        const redactarRecordatorio = unaVez(() =>
          this.aiMessageService.generate(
            'appointment_reminder',
            {
              employeeName:
                service.empleada?.nombreArtistico || 'Tu anfitriona',
            },
            respaldoRecordatorio,
          ),
        );
        // El cliente de Telegram sigue hasta la Fase 6; la Fase 5 es del personal.
        if (this.telegramEnabled && service.cliente?.telegramChatId) {
          try {
            const clientMsg = await redactarRecordatorio();
            await this.bot.telegram.sendMessage(
              service.cliente.telegramChatId,
              clientMsg,
              { parse_mode: 'Markdown' },
            );
          } catch (err) {
            this.logger.error(
              `Error notificando recordatorio al cliente de servicio ${service.id}:`,
              err,
            );
          }
        }
        await avisarAlChatWeb(
          this.conversationNotifier,
          this.logger,
          service,
          redactarRecordatorio,
          { respaldo: respaldoRecordatorio },
        );
      }
    }
  }

  /**
   * `notificar` no lanza, pero el ciclo recorre todas las citas proximas y un
   * fallo inesperado con una no puede dejar sin recordatorio a las demas.
   */
  private async avisar(
    usuarioId: string | null | undefined,
    aviso: Aviso,
  ): Promise<void> {
    if (!usuarioId) return;
    try {
      await this.notifications.notificar(usuarioId, aviso);
    } catch (err) {
      this.logger.error(`Error enviando el aviso push "${aviso.titulo}":`, err);
    }
  }
}
