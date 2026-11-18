import { LinkGroupRequestsToConversations1811005000000 } from './1811005000000-LinkGroupRequestsToConversations';

describe('LinkGroupRequestsToConversations migration', () => {
  it('agrega la columna, la llave y el indice de forma idempotente', async () => {
    const query = jest.fn();
    const migration = new LinkGroupRequestsToConversations1811005000000();

    await migration.up({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "conversation_id" uuid NULL',
    );
    expect(sql).toContain("WHERE conname = 'fk_group_requests_conversation'");
    expect(sql).toContain('REFERENCES "conversations"("id")');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_group_requests_conversation"',
    );
  });

  it('deshace todo en el rollback sin fallar si ya no existe', async () => {
    const query = jest.fn();
    const migration = new LinkGroupRequestsToConversations1811005000000();

    await migration.down({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "idx_group_requests_conversation"',
    );
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "fk_group_requests_conversation"',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "conversation_id"');
  });
});
