import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 6, D2: retirada definitiva de Telegram del esquema.
 *
 * El codigo ya no lee ni escribe nada de esto (D1). Hay datos reales en
 * produccion y la base no se regenera, asi que todo es idempotente: reintentar
 * tras un fallo parcial es seguro.
 *
 * Lo unico que se conserva son dos nombres de cliente, que siguen en uso:
 * `clientes.nombre_telegram` pasa a `nombre` y
 * `payment_receipt_validations.cliente_telegram` a `cliente_nombre`. Se
 * renombra y no se copia para no duplicar datos ni dejar dos fuentes.
 *
 * Los indices unicos (`usuarios_telegram_chat_id_key`,
 * `clientes_telegram_chat_id_key`, `uq_usuarios_telegram_verification_code`)
 * se van con su columna. No se hace `DROP INDEX` explicito porque falla si el
 * indice respalda una restriccion.
 *
 * `viajes.telegram_uber_file_id` se borra sin copiar: el codigo solo usa
 * `uber_screenshot_url`, que ya guarda la captura en R2.
 */

/** Tablas que solo existian por el bot; el chat web vive en `conversations`. */
const TABLAS = [
  'conversaciones_telegram',
  'telegram_sessions',
  'telegram_link_attempts',
  'panel_access_tokens',
  'employee_telegram_bots',
] as const;

/** Enum de `conversaciones_telegram.emisor`; es el unico de las tablas anteriores. */
const ENUM_EMISOR = 'conversaciones_telegram_emisor_enum';

/** Tabla, columna y tipo con el que el rollback la recrea (siempre sin datos y anulable). */
const COLUMNAS: ReadonlyArray<readonly [string, string, string]> = [
  ['usuarios', 'telegram_chat_id', 'bigint'],
  ['usuarios', 'grupo_telegram_id', 'bigint'],
  ['usuarios', 'telegram_verification_code', 'character varying(255)'],
  ['usuarios', 'telegram_verification_expires_at', 'timestamp with time zone'],
  ['clientes', 'telegram_chat_id', 'bigint'],
  ['clientes', 'admin_topic_id', 'integer'],
  ['empleadas', 'modo_bot', 'boolean DEFAULT true'],
  ['choferes', 'modo_bot', 'boolean DEFAULT true'],
  ['servicios', 'telegram_resumen_definitivo_id', 'character varying'],
  ['servicios', 'telegram_cliente_mensaje_id', 'character varying'],
  ['servicios', 'telegram_empleada_mensaje_id', 'character varying'],
  ['servicios', 'cliente_telegram_id', 'bigint'],
  ['servicios', 'telegram_thread_id', 'bigint'],
  ['viajes', 'telegram_uber_file_id', 'character varying'],
  ['viajes', 'telegram_empleada_msg_chofer_camino_id', 'character varying'],
  ['viajes', 'telegram_empleada_msg_chofer_llegado_id', 'character varying'],
  ['viajes', 'telegram_chofer_msg_oferta_id', 'character varying'],
  ['group_service_requests', 'telegram_thread_id', 'bigint'],
  ['candidate_screenings', 'telegram_chat_id', 'character varying(64)'],
  ['employee_onboardings', 'welcome_sent_at', 'timestamp with time zone'],
  ['employee_onboardings', 'regulation_sent_at', 'timestamp with time zone'],
  ['employee_onboardings', 'reminder_sent_at', 'timestamp with time zone'],
  ['payment_receipt_validations', 'chat_id', 'character varying(50)'],
  ['payment_receipt_validations', 'telegram_file_id', 'character varying(255)'],
];

/** Renombrados que conservan datos: tabla, nombre viejo, nombre nuevo. */
const RENOMBRADOS: ReadonlyArray<readonly [string, string, string]> = [
  ['clientes', 'nombre_telegram', 'nombre'],
  ['payment_receipt_validations', 'cliente_telegram', 'cliente_nombre'],
];

/**
 * Renombra solo si existe la columna origen y no la de destino. Con la guarda
 * por destino, un segundo intento (o una base ya migrada) no hace nada, y si
 * el destino existiera con otro uso no se pisa.
 */
function renombrar(tabla: string, desde: string, hacia: string): string {
  return `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = '${tabla}' AND column_name = '${desde}'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = '${tabla}' AND column_name = '${hacia}'
      ) THEN
        ALTER TABLE "${tabla}" RENAME COLUMN "${desde}" TO "${hacia}";
      END IF;
    END $$
  `;
}

export class RetirarTelegram1812000000000 implements MigrationInterface {
  name = 'RetirarTelegram1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [tabla, desde, hacia] of RENOMBRADOS) {
      await queryRunner.query(renombrar(tabla, desde, hacia));
    }

    for (const tabla of TABLAS) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${tabla}" CASCADE`);
    }
    // Tras borrar la tabla que lo usaba, el enum queda libre.
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."${ENUM_EMISOR}"`);

    for (const [tabla, columna] of COLUMNAS) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS "${tabla}" DROP COLUMN IF EXISTS "${columna}"`,
      );
    }
  }

  /**
   * SOLO ESQUEMA, SIN DATOS. Recrea columnas anulables y tablas vacias para
   * que una version anterior del codigo pueda arrancar; no restaura nada de lo
   * borrado. Para recuperar datos, el camino es restaurar el dump previo al
   * despliegue (scripts/backup-postgres.sh), no este metodo.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [tabla, desde, hacia] of RENOMBRADOS) {
      await queryRunner.query(renombrar(tabla, hacia, desde));
    }

    for (const [tabla, columna, tipo] of COLUMNAS) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS "${tabla}" ADD COLUMN IF NOT EXISTS "${columna}" ${tipo}`,
      );
    }

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."${ENUM_EMISOR}"
          AS ENUM ('ia', 'jefe', 'cliente', 'sistema');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversaciones_telegram" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "cliente_id" uuid NOT NULL,
        "servicio_id" uuid,
        "emisor" "public"."${ENUM_EMISOR}" NOT NULL,
        "mensaje" text NOT NULL,
        "ia_activa" boolean NOT NULL DEFAULT true,
        "enviado_at" timestamp with time zone NOT NULL DEFAULT now(),
        "booking_session_id" uuid,
        "intended_employee_id" uuid,
        "group_request_id" uuid,
        "historical_service_id" uuid,
        "telegram_message_id" bigint,
        "telegram_chat_id" character varying(64),
        "delete_at" timestamp with time zone,
        "delete_status" character varying(24),
        "delete_attempts" integer NOT NULL DEFAULT 0,
        "last_delete_error" text,
        "deleted_from_telegram_at" timestamp with time zone,
        "attachment" jsonb,
        "photo_file_id" text,
        CONSTRAINT "PK_a1cbab8f816262929baf6b8dde6" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_sessions" (
        "key" character varying(255) NOT NULL,
        "data" jsonb,
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_6f538baec8544a4efa4ded3dcdd" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_link_attempts" (
        "telegram_chat_id" character varying(64) PRIMARY KEY,
        "attempts" integer NOT NULL DEFAULT 0,
        "blocked_until" timestamp with time zone,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "panel_access_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" character(64) NOT NULL,
        "chat_id" character varying(64),
        "redirect_path" character varying(300),
        "expires_at" timestamp with time zone NOT NULL,
        "used_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_panel_access_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employee_telegram_bots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "employee_id" uuid NOT NULL,
        "token_ciphertext" text NOT NULL,
        "token_hint" character varying(8) NOT NULL,
        "bot_id" bigint,
        "bot_username" character varying(64),
        "status" character varying(20) NOT NULL DEFAULT 'pendiente',
        "last_error" text,
        "webhook_secret" character varying(64) NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "employee_telegram_bots_pkey" PRIMARY KEY ("id")
      )
    `);
  }
}
