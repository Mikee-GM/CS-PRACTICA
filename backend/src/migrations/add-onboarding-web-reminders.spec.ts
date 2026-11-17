import { AddOnboardingWebReminders1811004100000 } from './1811004100000-AddOnboardingWebReminders';

describe('AddOnboardingWebReminders migration', () => {
  it('agrega el contador y la fecha de forma idempotente', async () => {
    const query = jest.fn();
    const migration = new AddOnboardingWebReminders1811004100000();

    await migration.up({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ALTER TABLE "employee_onboardings"');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "web_reminder_count" smallint NOT NULL DEFAULT 0',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "last_web_reminder_at" timestamp with time zone NULL',
    );
  });

  it('elimina ambas columnas en el rollback', async () => {
    const query = jest.fn();
    const migration = new AddOnboardingWebReminders1811004100000();

    await migration.down({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('DROP COLUMN IF EXISTS "last_web_reminder_at"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "web_reminder_count"');
  });
});
