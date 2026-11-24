import { DataSource } from 'typeorm';
import {
  consultaDeVerificacion,
  VERIFICACIONES,
} from '../src/liquidations/conciliacion.verificaciones';

/**
 * Las consultas de la conciliacion contra el esquema migrado, con los parametros
 * de verdad.
 *
 * Una columna que no existe, un tipo mal inferido (`$1 - interval` sin `::timestamptz`
 * hacia que Postgres tomara el parametro por un intervalo) o un parametro que sobra
 * rompen la conciliacion entera con un 500, y los tests unitarios no lo ven porque
 * no tocan Postgres. En una base recien migrada y vacia ninguna debe devolver filas.
 */
describe('conciliacion de dinero: las consultas son validas contra el esquema real', () => {
  let base: DataSource;

  beforeAll(async () => {
    base = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
    });
    await base.initialize();
  });

  afterAll(async () => {
    await base.destroy();
  });

  const desde = new Date('2026-11-23T06:00:00.000Z');
  const hasta = new Date('2026-11-30T06:00:00.000Z');

  it.each(VERIFICACIONES.map((v) => [v.id, v.sql] as const))(
    '%s',
    async (_id, sql) => {
      const filas: unknown[] = await base.query(
        consultaDeVerificacion(sql),
        sql.includes('$1') ? [desde, hasta] : [],
      );

      expect(filas).toEqual([]);
    },
  );

  it('hay al menos una verificacion y ninguna repite su identificador', () => {
    const ids = VERIFICACIONES.map((v) => v.id);

    expect(ids.length).toBeGreaterThan(20);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
