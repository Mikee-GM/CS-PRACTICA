import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca de cambio de contraseña obligatorio (Fase 5, B-acceso).
 *
 * Sin correo, la contraseña inicial y la de un restablecimiento las pone el
 * admin o el jefe, asi que las conoce alguien mas que su dueño. La marca le
 * dice al frontend que pida cambiarla en el primer acceso.
 *
 * `DEFAULT false` deja intactas las cuentas que ya existen: quien ya entra con
 * su contraseña no tiene por que cambiarla al desplegar esto.
 */
export class AddMustChangePassword1811003000000 implements MigrationInterface {
  name = 'AddMustChangePassword1811003000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "usuarios"
      ADD COLUMN IF NOT EXISTS "debe_cambiar_password" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "usuarios"
      DROP COLUMN IF EXISTS "debe_cambiar_password";
    `);
  }
}
