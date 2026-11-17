import {
  MINUTOS_DE_UBICACION_FRESCA,
  sqlUbicacionFresca,
} from './ubicacion-fresca';

/**
 * La condicion de frescura la aplican el reparto, su diagnostico y la ficha
 * del jefe. Basta con que una de las tres se aparte para que el jefe vea a un
 * chofer "con ubicacion" que el reparto ignora.
 */
describe('La condicion de ubicacion fresca', () => {
  it('corta a los quince minutos', () => {
    expect(MINUTOS_DE_UBICACION_FRESCA).toBe(15);
    expect(sqlUbicacionFresca('c')).toContain("interval '15 minutes'");
  });

  /** La posicion tecleada a mano no lleva marca y no dice donde esta ahora. */
  it('trata una marca nula como vieja', () => {
    expect(sqlUbicacionFresca('c')).toContain(
      'c.ultima_ubicacion_at IS NOT NULL',
    );
  });

  it('compara contra el reloj de la base, no contra un parametro', () => {
    const sql = sqlUbicacionFresca('chofer');
    expect(sql).toContain('now()');
    expect(sql).not.toMatch(/[:$]\w/);
  });

  it('usa el alias que se le pide', () => {
    expect(sqlUbicacionFresca('chofer')).toContain(
      'chofer.ultima_ubicacion_at >=',
    );
  });
});
