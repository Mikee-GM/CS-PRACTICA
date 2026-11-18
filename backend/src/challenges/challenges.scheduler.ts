import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
} from '../common/scheduling/advisory-lock';
import { ChallengesService } from './challenges.service';
import { describeError } from '../common/errors/error-message';

@Injectable()
export class ChallengesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChallengesScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly challenges: ChallengesService,
    private readonly dataSource: DataSource,
  ) {}

  /*
   * Arranca siempre. La activacion y el cierre de los retos no dependen de ningun
   * canal de aviso.
   */
  onModuleInit() {
    this.timer = setInterval(() => void this.runCycle(), 5 * 60 * 1000);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
    const initialTimer = setTimeout(() => void this.runCycle(), 15_000);
    if (typeof initialTimer.unref === 'function') initialTimer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      // Advisory lock: activar o cerrar un reto dos veces desde dos replicas
      // duplicaria las notificaciones y los premios.
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.challenges,
        async () => {
          await this.challenges.activateDueChallenges();
          await this.challenges.finishDueChallenges();
        },
      );
    } catch (error) {
      this.logger.warn(`Error en el ciclo de retos: ${describeError(error)}`);
    } finally {
      this.running = false;
    }
  }
}
