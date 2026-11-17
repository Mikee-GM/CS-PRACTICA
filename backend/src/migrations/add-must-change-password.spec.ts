import { AddMustChangePassword1811003000000 } from './1811003000000-AddMustChangePassword';

describe('AddMustChangePassword migration', () => {
  it('agrega la marca de forma idempotente y apagada por defecto', async () => {
    const query = jest.fn();
    const migration = new AddMustChangePassword1811003000000();

    await migration.up({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ALTER TABLE "usuarios"');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "debe_cambiar_password" boolean NOT NULL DEFAULT false',
    );
  });

  it('elimina la marca en el rollback', async () => {
    const query = jest.fn();
    const migration = new AddMustChangePassword1811003000000();

    await migration.down({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('DROP COLUMN IF EXISTS "debe_cambiar_password"');
  });
});
