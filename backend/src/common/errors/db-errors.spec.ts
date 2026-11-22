import { esViolacionDeUnicidad } from './db-errors';

describe('esViolacionDeUnicidad', () => {
  it('reconoce el codigo 23505 en el error o en el del driver', () => {
    expect(esViolacionDeUnicidad({ code: '23505' })).toBe(true);
    expect(esViolacionDeUnicidad({ driverError: { code: '23505' } })).toBe(
      true,
    );
  });

  it('no confunde otros fallos con una clave duplicada', () => {
    expect(esViolacionDeUnicidad({ code: '40P01' })).toBe(false);
    expect(esViolacionDeUnicidad(new Error('conexion caida'))).toBe(false);
    expect(esViolacionDeUnicidad(null)).toBe(false);
    expect(esViolacionDeUnicidad('23505')).toBe(false);
  });
});
