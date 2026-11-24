import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Descuento al cliente que instala la app en su telefono.
 *
 * `beneficios_cliente` guarda una fila por cliente y tipo (el unico es
 * `instalacion_app`), asi que se otorga una sola vez. El servicio que lo usa
 * guarda el porcentaje y el trigger resta del total el porcentaje de la base:
 * `total_base` no cambia, y con el la ganancia de la modelo, que se calcula sobre
 * el precio base. El descuento lo absorbe la agencia, no la modelo ni el chofer.
 *
 * El importe se guarda en `descuento_cliente` (lo calcula el trigger) para que
 * historial y conciliacion lo lean sin repetir la cuenta.
 *
 * El timestamp es mayor que el del esquema base unico del entorno local, para que
 * en una base nueva corra despues de el.
 */
export class DescuentoPorInstalarLaApp1900000000004 implements MigrationInterface {
  name = 'DescuentoPorInstalarLaApp1900000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS beneficios_cliente (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        tipo character varying(40) NOT NULL,
        porcentaje numeric(5,2) NOT NULL,
        otorgado_at timestamp with time zone NOT NULL DEFAULT now(),
        caduca_at timestamp with time zone NOT NULL,
        servicio_id uuid REFERENCES servicios(id) ON DELETE SET NULL,
        CONSTRAINT beneficios_cliente_porcentaje_check
          CHECK (porcentaje > 0 AND porcentaje <= 100),
        CONSTRAINT beneficios_cliente_cliente_tipo_key UNIQUE (cliente_id, tipo)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_beneficios_cliente_servicio
        ON beneficios_cliente (servicio_id) WHERE servicio_id IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE servicios
        ADD COLUMN IF NOT EXISTS descuento_cliente_porcentaje numeric(5,2)
          NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS descuento_cliente numeric(10,2)
          NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE servicios
        DROP CONSTRAINT IF EXISTS servicios_descuento_cliente_porcentaje_check
    `);
    await queryRunner.query(`
      ALTER TABLE servicios
        ADD CONSTRAINT servicios_descuento_cliente_porcentaje_check
        CHECK (descuento_cliente_porcentaje >= 0 AND descuento_cliente_porcentaje <= 100)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.calcular_total_servicio() RETURNS trigger
          LANGUAGE plpgsql
          AS $$
      BEGIN
        NEW.service_base_amount_snapshot := COALESCE(
          NEW.service_base_amount_snapshot,
          NEW.duracion_pactada_horas * NEW.precio_base_hora_pactado
        );
        NEW.total_base := NEW.duracion_pactada_horas * NEW.precio_base_hora_pactado;
        NEW.descuento_cliente := round(
          NEW.total_base * COALESCE(NEW.descuento_cliente_porcentaje, 0) / 100,
          2
        );
        NEW.total_final := NEW.total_base + COALESCE(NEW.total_extras, 0)
          + COALESCE(NEW.total_transporte, 0) - NEW.descuento_cliente;
        RETURN NEW;
      END;
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.calcular_total_servicio() RETURNS trigger
          LANGUAGE plpgsql
          AS $$
      BEGIN
        NEW.service_base_amount_snapshot := COALESCE(
          NEW.service_base_amount_snapshot,
          NEW.duracion_pactada_horas * NEW.precio_base_hora_pactado
        );
        NEW.total_base := NEW.duracion_pactada_horas * NEW.precio_base_hora_pactado;
        NEW.total_final := NEW.total_base + COALESCE(NEW.total_extras, 0)
          + COALESCE(NEW.total_transporte, 0);
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      ALTER TABLE servicios
        DROP CONSTRAINT IF EXISTS servicios_descuento_cliente_porcentaje_check,
        DROP COLUMN IF EXISTS descuento_cliente,
        DROP COLUMN IF EXISTS descuento_cliente_porcentaje
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS beneficios_cliente`);
  }
}
