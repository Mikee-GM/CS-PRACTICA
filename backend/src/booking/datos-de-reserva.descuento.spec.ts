import {
  descuentoSobreLaBase,
  montoEsperadoDeTransferencia,
} from './datos-de-reserva';

describe('descuentoSobreLaBase', () => {
  it('es el porcentaje de la base, a dos decimales', () => {
    expect(descuentoSobreLaBase(2000, 10)).toBe(200);
    expect(descuentoSobreLaBase(1333.33, 10)).toBe(133.33);
    expect(descuentoSobreLaBase(999.99, 10)).toBe(100);
  });

  it('sin porcentaje valido no descuenta nada', () => {
    expect(descuentoSobreLaBase(2000, undefined)).toBe(0);
    expect(descuentoSobreLaBase(2000, 0)).toBe(0);
    expect(descuentoSobreLaBase(2000, -5)).toBe(0);
    expect(descuentoSobreLaBase(2000, NaN)).toBe(0);
  });

  it('nunca pasa del cien por ciento', () => {
    expect(descuentoSobreLaBase(500, 250)).toBe(500);
  });
});

describe('montoEsperadoDeTransferencia con descuento', () => {
  const borrador = {
    metodoPago: 'transferencia' as const,
    duracionPactadaHoras: 2,
    customerTransportCharge: 180,
  };

  it('descuenta solo la base y deja el transporte entero', () => {
    expect(montoEsperadoDeTransferencia(borrador, 1000)).toBe(2180);
    expect(
      montoEsperadoDeTransferencia({ ...borrador, descuentoPorcentaje: 10 }, 1000),
    ).toBe(1980);
  });

  it('coincide con lo que calcula el trigger de la base de datos', () => {
    // base 2000 - 10 % = 1800; mas transporte 180
    const monto = montoEsperadoDeTransferencia(
      { ...borrador, descuentoPorcentaje: 10 },
      1000,
    );
    expect(monto).toBe(2000 - 200 + 180);
  });
});
