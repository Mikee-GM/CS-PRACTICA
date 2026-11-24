import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El fin de un corte semanal confirmado se guardaba un dia de mas.
 *
 * El navegador manda el fin del periodo como domingo 23:59 de Mexico, que en UTC
 * ya es lunes, y el backend lo recortaba con `toISOString().slice(0, 10)`: la
 * semana del 23 al 29 quedaba como del 23 al 30. Cualquier calculo que usara
 * `week_end` para recorrer la semana incluia el lunes siguiente.
 *
 * Solo se tocan las filas que duran exactamente ocho dias (inicio mas siete):
 * una semana bien guardada termina en inicio mas seis y no se modifica, de modo
 * que repetir la migracion no hace nada.
 */
export class CorregirFinDeCorteSemanal1900000000002 implements MigrationInterface {
  name = 'CorregirFinDeCorteSemanal1900000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE employee_weekly_settlements
         SET week_end = week_start + 6
       WHERE week_end = week_start + 7
    `);
  }

  public async down(): Promise<void> {
    // No se puede distinguir una fila corregida de una que ya estaba bien.
  }
}
