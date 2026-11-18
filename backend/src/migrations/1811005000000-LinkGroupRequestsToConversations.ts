import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Solicitud grupal nacida del chat web (Fase 5, B-grupos).
 *
 * La de Telegram se identificaba por el chat del cliente y por el tema del
 * grupo del jefe. La web no tiene ninguno de los dos: lo que une la solicitud
 * con el cliente es su conversacion, por donde el jefe le escribe, le manda la
 * cotizacion y recibe el comprobante. `SET NULL` al borrar la conversacion: la
 * solicitud y su servicio son registro de negocio y no deben desaparecer con
 * el chat.
 */
export class LinkGroupRequestsToConversations1811005000000 implements MigrationInterface {
  name = 'LinkGroupRequestsToConversations1811005000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "group_service_requests"
      ADD COLUMN IF NOT EXISTS "conversation_id" uuid NULL;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_group_requests_conversation'
        ) THEN
          ALTER TABLE "group_service_requests"
            ADD CONSTRAINT "fk_group_requests_conversation"
            FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
            ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_group_requests_conversation"
        ON "group_service_requests" ("conversation_id")
        WHERE "conversation_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_group_requests_conversation";`,
    );
    await queryRunner.query(`
      ALTER TABLE "group_service_requests"
      DROP CONSTRAINT IF EXISTS "fk_group_requests_conversation";
    `);
    await queryRunner.query(`
      ALTER TABLE "group_service_requests"
      DROP COLUMN IF EXISTS "conversation_id";
    `);
  }
}
