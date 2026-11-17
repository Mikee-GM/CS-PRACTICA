import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientAccounts1811000000000 implements MigrationInterface {
  name = 'AddClientAccounts1811000000000';

  // ADD VALUE no se puede usar dentro de la misma transaccion que lo crea; con
  // el modo `each` esta migracion corre en la suya y el valor nuevo no se usa
  // hasta que termina.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."usuarios_rol_enum" ADD VALUE IF NOT EXISTS 'cliente'`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_usuarios_email_lower"
        ON "usuarios" (LOWER("email"))
    `);
    await queryRunner.query(`
      ALTER TABLE "clientes"
        ALTER COLUMN "telegram_chat_id" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "usuario_id" uuid,
        ADD COLUMN IF NOT EXISTS "correo_verificado_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "mayor_de_edad_declarado_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "terminos_aceptados_at" timestamptz
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_clientes_usuario_id"
        ON "clientes" ("usuario_id")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "clientes"
          ADD CONSTRAINT "fk_clientes_usuario"
          FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id")
          ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "verificaciones_correo" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "token_hash" char(64) NOT NULL,
        "expira_at" timestamptz NOT NULL,
        "usado_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_verificaciones_correo" PRIMARY KEY ("id"),
        CONSTRAINT "fk_verificaciones_correo_usuario"
          FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_verificaciones_correo_token"
        ON "verificaciones_correo" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_verificaciones_correo_usuario"
        ON "verificaciones_correo" ("usuario_id")
    `);
  }

  // El valor 'cliente' del enum no se quita: Postgres no permite borrar un
  // valor de un enum y dejarlo no estorba.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "verificaciones_correo"`);
    await queryRunner.query(
      `ALTER TABLE "clientes" DROP CONSTRAINT IF EXISTS "fk_clientes_usuario"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_clientes_usuario_id"`);
    await queryRunner.query(`
      ALTER TABLE "clientes"
        DROP COLUMN IF EXISTS "terminos_aceptados_at",
        DROP COLUMN IF EXISTS "mayor_de_edad_declarado_at",
        DROP COLUMN IF EXISTS "correo_verificado_at",
        DROP COLUMN IF EXISTS "usuario_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_usuarios_email_lower"`);
  }
}
