import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recordatorios web del reglamento (Fase 5, B-onboarding).
 *
 * El de Telegram era uno solo y se marcaba con `reminder_sent_at`. El web es un
 * push a las pocas horas y despues uno al dia hasta un tope, asi que hace falta
 * contarlos. Columnas propias y no `reminder_sent_at`: mientras convivan los
 * dos canales, reutilizarla haria que uno apagara el recordatorio del otro.
 */
export class AddOnboardingWebReminders1811004100000 implements MigrationInterface {
  name = 'AddOnboardingWebReminders1811004100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "employee_onboardings"
      ADD COLUMN IF NOT EXISTS "web_reminder_count" smallint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_web_reminder_at" timestamp with time zone NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "employee_onboardings"
      DROP COLUMN IF EXISTS "last_web_reminder_at",
      DROP COLUMN IF EXISTS "web_reminder_count";
    `);
  }
}
