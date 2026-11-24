import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cada registro de multa del corte guarda a que sancion pertenece.
 *
 * Antes la multa y su registro se unian por coincidencia de empleada, importe y
 * un trozo del motivo (`LIKE`). Al revocar una multa se borraba todo registro
 * que coincidiera: dos multas iguales de la misma empleada desaparecian juntas, y
 * una multa ya incluida en un corte pagado cambiaba ese corte despues.
 *
 * El timestamp es mayor que el del esquema base unico del entorno local, para que
 * en una base nueva corra despues de el.
 */
export class VincularMultaConSancion1900000000001
  implements MigrationInterface
{
  name = 'VincularMultaConSancion1900000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE liquidation_records
        ADD COLUMN IF NOT EXISTS sanction_id uuid
        REFERENCES disciplinary_sanctions(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_liquidation_records_sanction
        ON liquidation_records (sanction_id) WHERE sanction_id IS NOT NULL
    `);

    // Las multas que ya existen se enlazan solo cuando la coincidencia es unica:
    // si dos sanciones comparten empleada, importe y motivo no se adivina cual es
    // cual, y la conciliacion las deja a la vista.
    await queryRunner.query(`
      UPDATE liquidation_records r
         SET sanction_id = s.id
        FROM disciplinary_sanctions s
       WHERE r.is_fine
         AND r.sanction_id IS NULL
         AND s.type = 'fine'
         AND s.subject_type = 'employee'
         AND s.subject_id = r.employee_id
         AND s.fine_amount = r.fine_amount
         AND r.place = 'Multa: ' || btrim(s.reason)
         AND (
           SELECT count(*) FROM disciplinary_sanctions s2
            WHERE s2.type = 'fine' AND s2.subject_type = 'employee'
              AND s2.subject_id = r.employee_id
              AND s2.fine_amount = r.fine_amount
              AND 'Multa: ' || btrim(s2.reason) = r.place
         ) = 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_liquidation_records_sanction`);
    await queryRunner.query(
      `ALTER TABLE liquidation_records DROP COLUMN IF EXISTS sanction_id`,
    );
  }
}
