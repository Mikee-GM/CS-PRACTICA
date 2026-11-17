import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del feed de posts (fase 3 de la reescritura): el post, su media en R2
 * y los likes de los clientes.
 *
 * Los tipos enum se crean con un bloque que ignora `duplicate_object` porque
 * `CREATE TYPE` no admite `IF NOT EXISTS` y reintentar el despliegue debe ser
 * seguro. Por lo mismo el trigger se borra antes de crearse.
 *
 * `like_count` lo mantiene la base con un trigger sobre `post_likes`
 * (filosofia Heavy DB): el feed ordena y pinta el contador sin agregar likes en
 * cada lectura, y dos likes simultaneos no se pisan porque cada uno suma en su
 * propia sentencia.
 */
export class AddFeedPosts1811002000000 implements MigrationInterface {
  name = 'AddFeedPosts1811002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."posts_status_enum"
          AS ENUM ('borrador', 'pendiente', 'aprobado', 'rechazado', 'archivado');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."post_media_kind_enum"
          AS ENUM ('imagen', 'video');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "posts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "employee_id" uuid NOT NULL,
        "author_user_id" uuid,
        "author_role" text NOT NULL,
        "caption" text NOT NULL DEFAULT '',
        "status" "public"."posts_status_enum" NOT NULL DEFAULT 'borrador',
        "submitted_at" timestamptz,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "rejection_reason" text,
        "published_at" timestamptz,
        "archived_at" timestamptz,
        "like_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_posts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_posts_employee"
          FOREIGN KEY ("employee_id") REFERENCES "empleadas" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_posts_author_user"
          FOREIGN KEY ("author_user_id") REFERENCES "usuarios" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "fk_posts_reviewed_by"
          FOREIGN KEY ("reviewed_by") REFERENCES "usuarios" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "ck_posts_author_role" CHECK ("author_role" IN ('empleada', 'jefe', 'admin')),
        CONSTRAINT "ck_posts_caption_length" CHECK (char_length("caption") <= 2000),
        CONSTRAINT "ck_posts_like_count" CHECK ("like_count" >= 0),
        CONSTRAINT "ck_posts_rejection_reason" CHECK ("status" <> 'rechazado' OR "rejection_reason" IS NOT NULL),
        CONSTRAINT "ck_posts_approved_review" CHECK ("status" <> 'aprobado' OR "published_at" IS NOT NULL)
      )
    `);
    // El feed pagina por cursor `(published_at, id)` de lo mas reciente hacia
    // atras; los indices parciales solo cargan lo aprobado, que es lo unico
    // que se lee en caliente.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_posts_feed"
        ON "posts" ("published_at" DESC, "id" DESC)
       WHERE "status" = 'aprobado'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_posts_employee_feed"
        ON "posts" ("employee_id", "published_at" DESC, "id" DESC)
       WHERE "status" = 'aprobado'
    `);
    // Cola de revision del jefe, en orden de llegada.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_posts_employee_pending"
        ON "posts" ("employee_id", "submitted_at")
       WHERE "status" = 'pendiente'
    `);
    // Lista de la propia modelo, con todos sus estados.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_posts_employee_created"
        ON "posts" ("employee_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post_media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "post_id" uuid NOT NULL,
        "kind" "public"."post_media_kind_enum" NOT NULL,
        "url" text NOT NULL,
        "poster_url" text,
        "mime_type" text NOT NULL,
        "bytes" integer NOT NULL,
        "width" integer,
        "height" integer,
        "duration_ms" integer,
        "position" smallint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_post_media" PRIMARY KEY ("id"),
        CONSTRAINT "fk_post_media_post"
          FOREIGN KEY ("post_id") REFERENCES "posts" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "ck_post_media_poster_only_video" CHECK ("kind" = 'video' OR "poster_url" IS NULL),
        CONSTRAINT "uq_post_media_post_position" UNIQUE ("post_id", "position") DEFERRABLE INITIALLY DEFERRED
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post_likes" (
        "post_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_post_likes" PRIMARY KEY ("post_id", "client_id"),
        CONSTRAINT "fk_post_likes_post"
          FOREIGN KEY ("post_id") REFERENCES "posts" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_post_likes_client"
          FOREIGN KEY ("client_id") REFERENCES "clientes" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_post_likes_client_created"
        ON "post_likes" ("client_id", "created_at" DESC)
    `);

    // Al borrar un post, la cascada borra sus likes y este trigger corre con
    // el post ya eliminado: el UPDATE no encuentra fila y no hace nada. El
    // `like_count > 0` evita que un contador desajustado haga fallar el
    // borrado de un like por el CHECK.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION actualizar_like_count_post()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          UPDATE "posts" SET "like_count" = "like_count" + 1
           WHERE "id" = NEW."post_id";
        ELSIF TG_OP = 'DELETE' THEN
          UPDATE "posts" SET "like_count" = "like_count" - 1
           WHERE "id" = OLD."post_id" AND "like_count" > 0;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_post_likes_like_count ON "post_likes"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_post_likes_like_count
      AFTER INSERT OR DELETE ON "post_likes"
      FOR EACH ROW EXECUTE FUNCTION actualizar_like_count_post()
    `);
  }

  // El trigger, los indices y las llaves caen con sus tablas; la funcion y los
  // tipos van al final porque dependen de ellos.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "post_likes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post_media"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "posts"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS actualizar_like_count_post()`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."post_media_kind_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."posts_status_enum"`);
  }
}
