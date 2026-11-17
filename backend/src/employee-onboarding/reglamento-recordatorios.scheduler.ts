import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { describeError } from '../common/errors/error-message';
import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
} from '../common/scheduling/advisory-lock';
import { ReglamentoWebService } from './reglamento-web.service';

/**
 * Recordatorio push del reglamento (decision 7 de la Fase 5): a las
 * `ONBOARDING_REMINDER_HOURS` de asignarlo y despues uno al dia, con tope.
 *
 * No depende de Telegram ni del token del bot: corre siempre. Si el push no
 * esta configurado, `NotificationsService` lo registra como omitido y el
 * contador avanza igual, asi que tampoco se acumulan pendientes.
 */
@Injectable()
export class ReglamentoRecordatoriosScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReglamentoRecordatoriosScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly reglamentoWeb: ReglamentoWebService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    const intervalMs = this.configService.get<number>(
      'ONBOARDING_SCAN_INTERVAL_MS',
      60_000,
    );
    this.timer = setInterval(() => void this.run(), intervalMs);
    this.timer.unref();
    // Desfasado del ciclo de Telegram (5 s) para no competir en el arranque.
    setTimeout(() => void this.run(), 20_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(ahora = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      // Dos replicas barriendo a la vez mandarian el mismo recordatorio dos
      // veces; la clave de dedupe lo frenaria, pero contaria dos.
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.onboardingWebReminders,
        () => this.asignarYRecordar(ahora),
      );
    } catch (error) {
      this.logger.warn(
        `Error en el ciclo de recordatorios del reglamento: ${describeError(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async asignarYRecordar(ahora: Date): Promise<void> {
    await this.reglamentoWeb.asignarAlPersonalSinReglamento();

    const primeraTrasHoras = this.configService.get<number>(
      'ONBOARDING_REMINDER_HOURS',
      3,
    );
    const pendientes = await this.reglamentoWeb.recordatoriosPendientes(
      ahora,
      primeraTrasHoras,
    );
    for (const asignacion of pendientes) {
      try {
        await this.reglamentoWeb.enviarRecordatorio(asignacion, ahora);
      } catch (error) {
        this.logger.warn(
          `Falló el recordatorio del reglamento ${asignacion.id}: ${describeError(error)}`,
        );
      }
    }
  }
}
