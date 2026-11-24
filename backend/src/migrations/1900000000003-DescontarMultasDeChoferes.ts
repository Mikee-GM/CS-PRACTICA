import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las multas a choferes se descuentan en su corte semanal.
 *
 * Se registraban como sancion pero ningun corte las restaba del pago. Cada multa
 * guarda ahora en que corte se descuenta: mientras esta vacio sigue por descontar,
 * y deshacer el corte la libera.
 *
 * El timestamp es mayor que el del esquema base unico del entorno local, para que
 * en una base nueva corra despues de el.
 */
export class DescontarMultasDeChoferes1900000000003
  implements MigrationInterface
{
  name = 'DescontarMultasDeChoferes1900000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE disciplinary_sanctions
        ADD COLUMN IF NOT EXISTS driver_settlement_id uuid
        REFERENCES driver_settlements(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sanctions_driver_settlement
        ON disciplinary_sanctions (driver_settlement_id)
        WHERE driver_settlement_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_sanctions_driver_settlement`,
    );
    await queryRunner.query(
      `ALTER TABLE disciplinary_sanctions DROP COLUMN IF EXISTS driver_settlement_id`,
    );
  }
}
