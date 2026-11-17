import {
  generarPasswordTemporal,
  LONGITUD_PASSWORD_TEMPORAL,
} from './password-temporal';

describe('generarPasswordTemporal', () => {
  const muestras = Array.from({ length: 300 }, () => generarPasswordTemporal());

  it('tiene al menos 12 caracteres y cabe en los 72 de bcrypt', () => {
    expect(LONGITUD_PASSWORD_TEMPORAL).toBeGreaterThanOrEqual(12);
    for (const p of muestras) {
      expect(p).toHaveLength(LONGITUD_PASSWORD_TEMPORAL);
    }
  });

  it('cumple las reglas de una contraseña elegida: letra y numero', () => {
    for (const p of muestras) {
      expect(p).toMatch(/[A-Za-z]/);
      expect(p).toMatch(/\d/);
    }
  });

  it('no usa caracteres que se confunden al copiarlos a mano', () => {
    for (const p of muestras) {
      expect(p).not.toMatch(/[0O1lIo]/);
      expect(p).toMatch(/^[A-Za-z2-9]+$/);
    }
  });

  it('no se repite', () => {
    expect(new Set(muestras).size).toBe(muestras.length);
  });
});
