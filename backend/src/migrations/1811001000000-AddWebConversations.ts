import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del chat web (fase 2 de la reescritura). Conviven con
 * `conversaciones_telegram` hasta retirar el bot; no se copia nada de alli
 * porque la base del canal web arranca limpia.
 *
 * Los tipos enum se crean con un bloque que ignora `duplicate_object` porque
 * `CREATE TYPE` no admite `IF NOT EXISTS` y reintentar el despliegue debe ser
 * seguro.
 */
export class AddWebConversations1811001000000 implements MigrationInterface {
  name = 'AddWebConversations1811001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."conversations_status_enum"
          AS ENUM ('activa', 'en_revision', 'con_servicio', 'cerrada');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."conversations_mode_enum"
          AS ENUM ('AI_ACTIVE', 'HUMAN_ACTIVE');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."messages_sender_enum"
          AS ENUM ('cliente', 'ia', 'jefe', 'sistema');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "booking_session_id" uuid,
        "service_id" uuid,
        "status" "public"."conversations_status_enum" NOT NULL DEFAULT 'activa',
        "mode" "public"."conversations_mode_enum" NOT NULL DEFAULT 'AI_ACTIVE',
        "human_owner_id" uuid,
        "human_taken_at" timestamptz,
        "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "state_version" integer NOT NULL DEFAULT 0,
        "last_message_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_conversations_client"
          FOREIGN KEY ("client_id") REFERENCES "clientes" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_conversations_employee"
          FOREIGN KEY ("employee_id") REFERENCES "empleadas" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_conversations_booking_session"
          FOREIGN KEY ("booking_session_id")
          REFERENCES "customer_booking_sessions" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "fk_conversations_service"
          FOREIGN KEY ("service_id") REFERENCES "servicios" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "fk_conversations_human_owner"
          FOREIGN KEY ("human_owner_id") REFERENCES "usuarios" ("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversations_client_employee_open"
        ON "conversations" ("client_id", "employee_id")
       WHERE "status" <> 'cerrada'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversations_booking_session"
        ON "conversations" ("booking_session_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversations_client_last_message"
        ON "conversations" ("client_id", "last_message_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversations_employee_last_message"
        ON "conversations" ("employee_id", "last_message_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversations_human_owner"
        ON "conversations" ("human_owner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_conversations_service"
        ON "conversations" ("service_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "sender" "public"."messages_sender_enum" NOT NULL,
        "body" text NOT NULL DEFAULT '',
        "attachment" jsonb,
        "receipt_validation_id" uuid,
        "client_message_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_messages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_messages_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_messages_receipt_validation"
          FOREIGN KEY ("receipt_validation_id")
          REFERENCES "payment_receipt_validations" ("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_messages_conversation_created"
        ON "messages" ("conversation_id", "created_at", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_messages_conversation_client_message"
        ON "messages" ("conversation_id", "client_message_id")
       WHERE "client_message_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_messages_receipt_validation"
        ON "messages" ("receipt_validation_id")
    `);
  }

  // Los indices y llaves caen con sus tablas; los tipos van al final porque
  // las columnas dependen de ellos.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."messages_sender_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."conversations_mode_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."conversations_status_enum"`,
    );
  }
}
