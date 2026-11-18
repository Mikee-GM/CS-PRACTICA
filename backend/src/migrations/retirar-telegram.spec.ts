import { RetirarTelegram1812000000000 } from './1812000000000-RetirarTelegram';

const TABLAS = [
  'conversaciones_telegram',
  'telegram_sessions',
  'telegram_link_attempts',
  'panel_access_tokens',
  'employee_telegram_bots',
];

const COLUMNAS: Array<[string, string[]]> = [
  [
    'usuarios',
    [
      'telegram_chat_id',
      'grupo_telegram_id',
      'telegram_verification_code',
      'telegram_verification_expires_at',
    ],
  ],
  ['clientes', ['telegram_chat_id', 'admin_topic_id']],
  ['empleadas', ['modo_bot']],
  ['choferes', ['modo_bot']],
  [
    'servicios',
    [
      'telegram_resumen_definitivo_id',
      'telegram_cliente_mensaje_id',
      'telegram_empleada_mensaje_id',
      'cliente_telegram_id',
      'telegram_thread_id',
    ],
  ],
  [
    'viajes',
    [
      'telegram_uber_file_id',
      'telegram_empleada_msg_chofer_camino_id',
      'telegram_empleada_msg_chofer_llegado_id',
      'telegram_chofer_msg_oferta_id',
    ],
  ],
  ['group_service_requests', ['telegram_thread_id']],
  ['candidate_screenings', ['telegram_chat_id']],
  [
    'employee_onboardings',
    ['welcome_sent_at', 'regulation_sent_at', 'reminder_sent_at'],
  ],
  ['payment_receipt_validations', ['chat_id', 'telegram_file_id']],
];

async function sentencias(fase: 'up' | 'down'): Promise<string[]> {
  const query = jest.fn();
  const migration = new RetirarTelegram1812000000000();
  await migration[fase]({ query } as any);
  return query.mock.calls.map(([sql]) => String(sql));
}

describe('RetirarTelegram migration', () => {
  it('borra cada tabla del bot con IF EXISTS y CASCADE', async () => {
    const sql = (await sentencias('up')).join('\n');

    for (const tabla of TABLAS) {
      expect(sql).toContain(`DROP TABLE IF EXISTS "${tabla}" CASCADE`);
    }
    expect(sql).toContain(
      'DROP TYPE IF EXISTS "public"."conversaciones_telegram_emisor_enum"',
    );
  });

  it('borra cada columna con IF EXISTS tanto en la tabla como en la columna', async () => {
    const sql = (await sentencias('up')).join('\n');

    for (const [tabla, columnas] of COLUMNAS) {
      for (const columna of columnas) {
        expect(sql).toContain(
          `ALTER TABLE IF EXISTS "${tabla}" DROP COLUMN IF EXISTS "${columna}"`,
        );
      }
    }
  });

  it('todo DROP lleva IF EXISTS y no hay DROP INDEX ni CASCADE sobre columnas', async () => {
    for (const sql of await sentencias('up')) {
      const drops = sql.match(/\bDROP\s+(TABLE|TYPE|COLUMN|INDEX)\b/g) ?? [];
      const seguros =
        sql.match(/\bDROP\s+(TABLE|TYPE|COLUMN|INDEX)\s+IF EXISTS\b/g) ?? [];
      expect(seguros).toHaveLength(drops.length);
      expect(sql).not.toContain('DROP INDEX');
    }
  });

  it('renombra los dos nombres de cliente con guarda y sin copiar datos', async () => {
    const sqls = await sentencias('up');
    const sql = sqls.join('\n');

    for (const [tabla, desde, hacia] of [
      ['clientes', 'nombre_telegram', 'nombre'],
      ['payment_receipt_validations', 'cliente_telegram', 'cliente_nombre'],
    ]) {
      const bloque = sqls.find((s) =>
        s.includes(`RENAME COLUMN "${desde}" TO "${hacia}"`),
      );
      expect(bloque).toBeDefined();
      expect(bloque).toContain('DO $$');
      expect(bloque).toContain(
        `table_name = '${tabla}' AND column_name = '${desde}'`,
      );
      expect(bloque).toMatch(
        new RegExp(
          `NOT EXISTS[\\s\\S]*table_name = '${tabla}' AND column_name = '${hacia}'`,
        ),
      );
    }
    expect(sql).not.toMatch(/\bUPDATE\b/);
  });

  it('los renombrados ocurren antes de borrar columnas', async () => {
    const sqls = await sentencias('up');
    const renombrado = sqls.findIndex((s) => s.includes('RENAME COLUMN'));
    const primerDrop = sqls.findIndex((s) => s.includes('DROP'));

    expect(renombrado).toBeGreaterThanOrEqual(0);
    expect(renombrado).toBeLessThan(primerDrop);
  });

  it('el rollback recrea el esquema, revierte los renombrados y no borra datos', async () => {
    const sqls = await sentencias('down');
    const sql = sqls.join('\n');

    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/);
    expect(sql).toContain('RENAME COLUMN "nombre" TO "nombre_telegram"');
    expect(sql).toContain(
      'RENAME COLUMN "cliente_nombre" TO "cliente_telegram"',
    );

    for (const tabla of TABLAS) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${tabla}"`);
    }
    for (const [tabla, columnas] of COLUMNAS) {
      for (const columna of columnas) {
        expect(sql).toContain(
          `ALTER TABLE IF EXISTS "${tabla}" ADD COLUMN IF NOT EXISTS "${columna}"`,
        );
      }
    }
    // Ninguna columna recreada exige valor: la tabla ya tiene filas.
    expect(sql).not.toMatch(
      /ADD COLUMN IF NOT EXISTS "[a-z_]+" [^\n]*NOT NULL/,
    );
  });
});
