import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource, EntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '1811001000000-AddWebConversations.ts',
);

/**
 * Construye los metadatos de TypeORM sin abrir conexion: `buildMetadatas` es
 * protegido pero no toca la base. Se cargan todas las entidades porque las
 * relaciones de estas dos arrastran a `clientes`, `servicios`, etc.
 */
async function buildMetadata(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [join(__dirname, '..', '**', '*.entity.ts')],
  });
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource;
}

/** Bloque `CREATE TABLE` de la migracion para una tabla. */
function createTableBlock(sql: string, table: string): string {
  const match = new RegExp(
    `CREATE TABLE IF NOT EXISTS "${table}" \\(([\\s\\S]*?)\\n\\s*\\)\\n`,
  ).exec(sql);
  if (!match) throw new Error(`La migracion no crea la tabla ${table}`);
  return match[1];
}

/** Definicion de una columna dentro del `CREATE TABLE`. */
function columnDefinition(block: string, column: string): string {
  const match = new RegExp(`^\\s*"${column}" (.+?),?$`, 'm').exec(block);
  if (!match) throw new Error(`La migracion no declara la columna ${column}`);
  return match[1];
}

/** Default que la migracion deberia escribir para la columna. */
function defaultSql(column: ColumnMetadata): string | undefined {
  if (column.isCreateDate || column.isUpdateDate) return 'now()';
  const value: unknown = column.default;
  if (typeof value === 'function') return (value as () => string)();
  if (value === undefined) return undefined;
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new Error(`Default no soportado en ${column.databaseName}`);
}

const POSTGRES_TYPE: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  jsonb: 'jsonb',
  integer: 'integer',
  'timestamp with time zone': 'timestamptz',
};

describe('Entidades de conversaciones web', () => {
  let dataSource: DataSource;
  let conversation: EntityMetadata;
  let message: EntityMetadata;
  // Con autocrlf en Windows el archivo puede llegar con CRLF.
  const migration = readFileSync(MIGRATION_PATH, 'utf8').replace(/\r\n/g, '\n');

  beforeAll(async () => {
    dataSource = await buildMetadata();
    conversation = dataSource.getMetadata(Conversation);
    message = dataSource.getMetadata(Message);
  });

  describe('metadatos', () => {
    it('mapea las tablas conversations y messages', () => {
      expect(conversation.tableName).toBe('conversations');
      expect(message.tableName).toBe('messages');
    });

    it('declara los enums con nombre y default', () => {
      const status = conversation.findColumnWithDatabaseName('status');
      const mode = conversation.findColumnWithDatabaseName('mode');
      const sender = message.findColumnWithDatabaseName('sender');

      expect(status?.type).toBe('enum');
      expect(status?.enumName).toBe('conversations_status_enum');
      expect(status?.enum).toEqual([
        'activa',
        'en_revision',
        'con_servicio',
        'cerrada',
      ]);
      expect(status?.default).toBe('activa');
      expect(mode?.enumName).toBe('conversations_mode_enum');
      expect(mode?.enum).toEqual(['AI_ACTIVE', 'HUMAN_ACTIVE']);
      expect(mode?.default).toBe('AI_ACTIVE');
      expect(sender?.enumName).toBe('messages_sender_enum');
      expect(sender?.enum).toEqual(['cliente', 'ia', 'jefe', 'sistema']);
    });

    it('marca como opcionales solo las columnas previstas', () => {
      const nullable = (metadata: EntityMetadata) =>
        metadata.columns
          .filter((column) => column.isNullable)
          .map((column) => column.databaseName)
          .sort();

      expect(nullable(conversation)).toEqual([
        'booking_session_id',
        'human_owner_id',
        'human_taken_at',
        'last_message_at',
        'service_id',
      ]);
      expect(nullable(message)).toEqual([
        'attachment',
        'client_message_id',
        'receipt_validation_id',
      ]);
    });

    it('limita a una conversacion abierta por cliente y modelo', () => {
      const index = conversation.indices.find(
        (candidate) =>
          candidate.name === 'uq_conversations_client_employee_open',
      );
      expect(index?.isUnique).toBe(true);
      expect(index?.where).toBe(`"status" <> 'cerrada'`);
      expect(index?.columns.map((column) => column.databaseName)).toEqual([
        'client_id',
        'employee_id',
      ]);
    });

    it('indexa el cursor de paginacion y la idempotencia de mensajes', () => {
      const cursor = message.indices.find(
        (candidate) => candidate.name === 'idx_messages_conversation_created',
      );
      const idempotency = message.indices.find(
        (candidate) =>
          candidate.name === 'uq_messages_conversation_client_message',
      );

      expect(cursor?.columns.map((column) => column.databaseName)).toEqual([
        'conversation_id',
        'created_at',
        'id',
      ]);
      expect(idempotency?.isUnique).toBe(true);
      expect(idempotency?.where).toBe(`"client_message_id" IS NOT NULL`);
    });

    it('declara las llaves foraneas con su accion de borrado', () => {
      const foreignKeys = (metadata: EntityMetadata) =>
        Object.fromEntries(
          metadata.foreignKeys.map((foreignKey) => [
            foreignKey.name,
            `${foreignKey.referencedEntityMetadata.tableName}:${foreignKey.onDelete}`,
          ]),
        );

      expect(foreignKeys(conversation)).toEqual({
        fk_conversations_client: 'clientes:CASCADE',
        fk_conversations_employee: 'empleadas:RESTRICT',
        fk_conversations_booking_session: 'customer_booking_sessions:SET NULL',
        fk_conversations_service: 'servicios:SET NULL',
        fk_conversations_human_owner: 'usuarios:SET NULL',
      });
      expect(foreignKeys(message)).toEqual({
        fk_messages_conversation: 'conversations:CASCADE',
        fk_messages_receipt_validation: 'payment_receipt_validations:SET NULL',
      });
    });
  });

  // Si alguien cambia la entidad y no la migracion (o al reves) esto falla
  // antes de que `synchronize: false` lo esconda hasta produccion.
  describe('coincidencia con la migracion', () => {
    const entities = () => [conversation, message];

    it('declara cada columna con el mismo tipo, nulabilidad y default', () => {
      for (const metadata of entities()) {
        const block = createTableBlock(migration, metadata.tableName);
        for (const column of metadata.columns) {
          const name = column.databaseName;
          const definition = columnDefinition(block, name);
          const expectedType =
            column.type === 'enum'
              ? `"public"."${column.enumName}"`
              : POSTGRES_TYPE[String(column.type)];
          const expectedDefault = defaultSql(column);

          // El nombre de la columna va en cada aserto para que el fallo
          // diga cual diverge.
          const sameType =
            definition === expectedType ||
            definition.startsWith(`${expectedType} `);
          expect([name, sameType]).toEqual([name, true]);
          expect([name, definition.includes('NOT NULL')]).toEqual([
            name,
            !column.isNullable,
          ]);
          if (expectedDefault === undefined) {
            expect([name, definition]).not.toEqual([
              name,
              expect.stringContaining('DEFAULT'),
            ]);
          } else {
            expect([name, definition]).toEqual([
              name,
              expect.stringContaining(`DEFAULT ${expectedDefault}`),
            ]);
          }
        }
      }
    });

    it('crea cada indice con sus columnas y condicion', () => {
      for (const metadata of entities()) {
        for (const index of metadata.indices) {
          const columns = index.columns
            .map((column) => `"${column.databaseName}"`)
            .join(', ');
          const unique = index.isUnique ? 'UNIQUE ' : '';
          const where = index.where
            ? `\\s+WHERE ${index.where.replace(/[()]/g, '\\$&')}`
            : '\\n';
          expect(migration).toMatch(
            new RegExp(
              `CREATE ${unique}INDEX IF NOT EXISTS "${index.name}"\\s+` +
                `ON "${metadata.tableName}" \\(${columns}\\)${where}`,
            ),
          );
        }
      }
    });

    it('crea cada llave foranea con la misma accion de borrado', () => {
      for (const metadata of entities()) {
        for (const foreignKey of metadata.foreignKeys) {
          const columns = foreignKey.columnNames
            .map((name) => `"${name}"`)
            .join(', ');
          expect(migration).toMatch(
            new RegExp(
              `CONSTRAINT "${foreignKey.name}"\\s+FOREIGN KEY \\(${columns}\\)` +
                `\\s+REFERENCES "${foreignKey.referencedEntityMetadata.tableName}" \\("id"\\)` +
                `\\s+ON DELETE ${foreignKey.onDelete}`,
            ),
          );
        }
      }
    });

    it('crea los enums con los mismos valores y los borra en down', () => {
      for (const metadata of entities()) {
        for (const column of metadata.columns.filter(
          (candidate) => candidate.type === 'enum',
        )) {
          const values = (column.enum ?? [])
            .map((value) => `'${String(value)}'`)
            .join(', ');
          expect(migration).toMatch(
            new RegExp(
              `CREATE TYPE "public"\\."${column.enumName}"\\s+` +
                `AS ENUM \\(${values}\\);`,
            ),
          );
          expect(migration).toContain(
            `DROP TYPE IF EXISTS "public"."${column.enumName}"`,
          );
        }
      }
    });

    it('nombra la llave primaria y borra ambas tablas en down', () => {
      for (const metadata of entities()) {
        expect(migration).toContain(
          `CONSTRAINT "${metadata.primaryColumns[0].primaryKeyConstraintName}" PRIMARY KEY ("id")`,
        );
        expect(migration).toContain(
          `DROP TABLE IF EXISTS "${metadata.tableName}"`,
        );
      }
    });
  });
});
