import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource, EntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { PostLike } from './entities/post-like.entity';
import { PostMedia } from './entities/post-media.entity';
import { Post } from './entities/post.entity';
import { MAX_CAPTION } from './post-estados';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '1811002000000-AddFeedPosts.ts',
);

/**
 * Construye los metadatos de TypeORM sin abrir conexion: `buildMetadatas` es
 * protegido pero no toca la base. Se cargan todas las entidades porque las
 * relaciones arrastran a `empleadas`, `usuarios` y `clientes`.
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

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const POSTGRES_TYPE: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  integer: 'integer',
  smallint: 'smallint',
  'timestamp with time zone': 'timestamptz',
};

describe('Entidades del feed de posts', () => {
  let dataSource: DataSource;
  let post: EntityMetadata;
  let media: EntityMetadata;
  let like: EntityMetadata;
  // Con autocrlf en Windows el archivo puede llegar con CRLF.
  const migration = readFileSync(MIGRATION_PATH, 'utf8').replace(/\r\n/g, '\n');
  const [up, down] = migration.split('public async down');

  beforeAll(async () => {
    dataSource = await buildMetadata();
    post = dataSource.getMetadata(Post);
    media = dataSource.getMetadata(PostMedia);
    like = dataSource.getMetadata(PostLike);
  });

  const entities = () => [post, media, like];

  describe('metadatos', () => {
    it('mapea las tablas posts, post_media y post_likes', () => {
      expect(post.tableName).toBe('posts');
      expect(media.tableName).toBe('post_media');
      expect(like.tableName).toBe('post_likes');
    });

    it('declara los enums con nombre y default', () => {
      const status = post.findColumnWithDatabaseName('status');
      const kind = media.findColumnWithDatabaseName('kind');

      expect(status?.type).toBe('enum');
      expect(status?.enumName).toBe('posts_status_enum');
      expect(status?.enum).toEqual([
        'borrador',
        'pendiente',
        'aprobado',
        'rechazado',
        'archivado',
      ]);
      expect(status?.default).toBe('borrador');
      expect(kind?.enumName).toBe('post_media_kind_enum');
      expect(kind?.enum).toEqual(['imagen', 'video']);
    });

    it('marca como opcionales solo las columnas previstas', () => {
      const nullable = (metadata: EntityMetadata) =>
        metadata.columns
          .filter((column) => column.isNullable)
          .map((column) => column.databaseName)
          .sort();

      expect(nullable(post)).toEqual([
        'archived_at',
        'author_user_id',
        'published_at',
        'rejection_reason',
        'reviewed_at',
        'reviewed_by',
        'submitted_at',
      ]);
      expect(nullable(media)).toEqual([
        'duration_ms',
        'height',
        'poster_url',
        'width',
      ]);
      expect(nullable(like)).toEqual([]);
    });

    it('impide que TypeORM escriba el contador de likes', () => {
      const likeCount = post.findColumnWithDatabaseName('like_count');
      expect(likeCount?.isInsert).toBe(false);
      expect(likeCount?.isUpdate).toBe(false);
    });

    it('declara las llaves foraneas con su accion de borrado', () => {
      const foreignKeys = (metadata: EntityMetadata) =>
        Object.fromEntries(
          metadata.foreignKeys.map((foreignKey) => [
            foreignKey.name,
            `${foreignKey.referencedEntityMetadata.tableName}:${foreignKey.onDelete}`,
          ]),
        );

      expect(foreignKeys(post)).toEqual({
        fk_posts_employee: 'empleadas:RESTRICT',
        fk_posts_author_user: 'usuarios:SET NULL',
        fk_posts_reviewed_by: 'usuarios:SET NULL',
      });
      expect(foreignKeys(media)).toEqual({
        fk_post_media_post: 'posts:CASCADE',
      });
      expect(foreignKeys(like)).toEqual({
        fk_post_likes_post: 'posts:CASCADE',
        fk_post_likes_client: 'clientes:CASCADE',
      });
    });

    it('usa (post_id, client_id) como llave primaria de los likes', () => {
      expect(like.primaryColumns.map((column) => column.databaseName)).toEqual([
        'post_id',
        'client_id',
      ]);
    });

    it('difiere la unicidad de la posicion de la media', () => {
      const unique = media.uniques.find(
        (candidate) => candidate.name === 'uq_post_media_post_position',
      );
      expect(unique?.deferrable).toBe('INITIALLY DEFERRED');
      expect(unique?.columns.map((column) => column.databaseName)).toEqual([
        'post_id',
        'position',
      ]);
    });

    it('declara las restricciones CHECK previstas', () => {
      expect(post.checks.map((check) => check.name).sort()).toEqual([
        'ck_posts_approved_review',
        'ck_posts_author_role',
        'ck_posts_caption_length',
        'ck_posts_like_count',
        'ck_posts_rejection_reason',
      ]);
      expect(media.checks.map((check) => check.name)).toEqual([
        'ck_post_media_poster_only_video',
      ]);
    });
  });

  // Si alguien cambia la entidad y no la migracion (o al reves) esto falla
  // antes de que `synchronize: false` lo esconda hasta produccion.
  describe('coincidencia con la migracion', () => {
    it('declara cada columna con el mismo tipo, nulabilidad y default', () => {
      for (const metadata of entities()) {
        const block = createTableBlock(up, metadata.tableName);
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

    // TypeORM no guarda el orden de las columnas del indice, asi que aqui
    // cada columna admite `DESC`; la prueba siguiente fija cuales lo llevan.
    it('crea cada indice con sus columnas y condicion', () => {
      for (const metadata of entities()) {
        for (const index of metadata.indices) {
          const columns = index.columns
            .map((column) => `"${column.databaseName}"(?: DESC)?`)
            .join(', ');
          const unique = index.isUnique ? 'UNIQUE ' : '';
          const where = index.where
            ? `\\s+WHERE ${escapeRegExp(index.where)}`
            : '\\n';
          expect(up).toMatch(
            new RegExp(
              `CREATE ${unique}INDEX IF NOT EXISTS "${index.name}"\\s+` +
                `ON "${metadata.tableName}" \\(${columns}\\)${where}`,
            ),
          );
        }
      }
    });

    it('ordena de forma descendente los indices del feed y de los likes', () => {
      expect(up).toContain(
        `"idx_posts_feed"\n        ON "posts" ("published_at" DESC, "id" DESC)`,
      );
      expect(up).toContain(
        `"idx_posts_employee_feed"\n        ON "posts" ("employee_id", "published_at" DESC, "id" DESC)`,
      );
      expect(up).toContain(
        `"idx_posts_employee_created"\n        ON "posts" ("employee_id", "created_at" DESC)`,
      );
      expect(up).toContain(
        `"idx_post_likes_client_created"\n        ON "post_likes" ("client_id", "created_at" DESC)`,
      );
    });

    it('crea cada llave foranea con la misma accion de borrado', () => {
      for (const metadata of entities()) {
        for (const foreignKey of metadata.foreignKeys) {
          const columns = foreignKey.columnNames
            .map((name) => `"${name}"`)
            .join(', ');
          expect(up).toMatch(
            new RegExp(
              `CONSTRAINT "${foreignKey.name}"\\s+FOREIGN KEY \\(${columns}\\)` +
                `\\s+REFERENCES "${foreignKey.referencedEntityMetadata.tableName}" \\("id"\\)` +
                `\\s+ON DELETE ${foreignKey.onDelete}`,
            ),
          );
        }
      }
    });

    it('crea cada CHECK con la misma expresion', () => {
      for (const metadata of entities()) {
        const block = createTableBlock(up, metadata.tableName);
        for (const check of metadata.checks) {
          expect(block).toContain(
            `CONSTRAINT "${check.name}" CHECK (${check.expression})`,
          );
        }
      }
      expect(up).toContain(`char_length("caption") <= ${MAX_CAPTION}`);
    });

    it('crea la unicidad diferida de la posicion', () => {
      expect(createTableBlock(up, 'post_media')).toContain(
        `CONSTRAINT "uq_post_media_post_position" UNIQUE ("post_id", "position") DEFERRABLE INITIALLY DEFERRED`,
      );
    });

    it('crea los enums con los mismos valores y los borra en down', () => {
      for (const metadata of entities()) {
        for (const column of metadata.columns.filter(
          (candidate) => candidate.type === 'enum',
        )) {
          const values = (column.enum ?? [])
            .map((value) => `'${String(value)}'`)
            .join(', ');
          expect(up).toMatch(
            new RegExp(
              `CREATE TYPE "public"\\."${column.enumName}"\\s+` +
                `AS ENUM \\(${values}\\);`,
            ),
          );
          expect(down).toContain(
            `DROP TYPE IF EXISTS "public"."${column.enumName}"`,
          );
        }
      }
    });

    it('nombra las llaves primarias y borra las tablas en down', () => {
      for (const metadata of entities()) {
        const columns = metadata.primaryColumns
          .map((column) => `"${column.databaseName}"`)
          .join(', ');
        expect(createTableBlock(up, metadata.tableName)).toContain(
          `CONSTRAINT "${metadata.primaryColumns[0].primaryKeyConstraintName}" PRIMARY KEY (${columns})`,
        );
        expect(down).toContain(`DROP TABLE IF EXISTS "${metadata.tableName}"`);
      }
    });

    // Los likes se borran antes que los posts y estos antes que los tipos.
    it('borra en down en orden de dependencias', () => {
      const order = [
        `DROP TABLE IF EXISTS "post_likes"`,
        `DROP TABLE IF EXISTS "post_media"`,
        `DROP TABLE IF EXISTS "posts"`,
        `DROP FUNCTION IF EXISTS actualizar_like_count_post()`,
        `DROP TYPE IF EXISTS "public"."post_media_kind_enum"`,
        `DROP TYPE IF EXISTS "public"."posts_status_enum"`,
      ].map((statement) => down.indexOf(statement));
      expect(order.every((position) => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  });

  describe('trigger del contador de likes', () => {
    it('suma en INSERT y resta en DELETE sobre posts.like_count', () => {
      expect(up).toContain(
        'CREATE OR REPLACE FUNCTION actualizar_like_count_post()',
      );
      expect(up).toMatch(
        /IF TG_OP = 'INSERT' THEN\s+UPDATE "posts" SET "like_count" = "like_count" \+ 1\s+WHERE "id" = NEW\."post_id";/,
      );
      expect(up).toMatch(
        /ELSIF TG_OP = 'DELETE' THEN\s+UPDATE "posts" SET "like_count" = "like_count" - 1\s+WHERE "id" = OLD\."post_id" AND "like_count" > 0;/,
      );
      expect(up).toContain('$$ LANGUAGE plpgsql');
    });

    it('se crea por fila tras borrar el anterior, para poder reintentar', () => {
      const drop = up.indexOf(
        `DROP TRIGGER IF EXISTS trg_post_likes_like_count ON "post_likes"`,
      );
      const create = up.search(
        /CREATE TRIGGER trg_post_likes_like_count\s+AFTER INSERT OR DELETE ON "post_likes"\s+FOR EACH ROW EXECUTE FUNCTION actualizar_like_count_post\(\)/,
      );
      expect(drop).toBeGreaterThan(-1);
      expect(create).toBeGreaterThan(drop);
    });
  });
});
