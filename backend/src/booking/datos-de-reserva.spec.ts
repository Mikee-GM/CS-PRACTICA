import {
  datosDeReserva,
  montoEsperadoDeTransferencia,
} from './datos-de-reserva';

describe('montoEsperadoDeTransferencia', () => {
  it('suma las horas por la tarifa de la modelo', () => {
    expect(
      montoEsperadoDeTransferencia({ duracionPactadaHoras: 2 }, 1200),
    ).toBe(2400);
  });

  it('incluye el transporte cotizado', () => {
    expect(
      montoEsperadoDeTransferencia(
        { duracionPactadaHoras: 2, customerTransportCharge: 350 },
        1200,
      ),
    ).toBe(2750);
  });

  it('usa la tarifa combinada del trio', () => {
    expect(
      montoEsperadoDeTransferencia(
        { duracionPactadaHoras: 2, trioCombinedRatePerHour: 2000 },
        1200,
      ),
    ).toBe(4000);
  });

  it('en mixto espera solo la parte transferida, redondeada', () => {
    expect(
      montoEsperadoDeTransferencia(
        {
          duracionPactadaHoras: 3,
          metodoPago: 'mixto',
          mixedTransferAmount: 1000.005,
          customerTransportCharge: 350,
        },
        1200,
      ),
    ).toBe(1000.01);
  });

  /** Sin horas pactadas todavia se cobra al menos una. */
  it('sin duracion cuenta una hora, y acepta la tarifa como texto', () => {
    expect(montoEsperadoDeTransferencia({}, '1200.50')).toBe(1200.5);
  });

  it('opera en centavos: no arrastra el error de coma flotante', () => {
    expect(
      montoEsperadoDeTransferencia(
        { duracionPactadaHoras: 3, customerTransportCharge: 0.2 },
        0.1,
      ),
    ).toBe(0.5);
  });
});

describe('datosDeReserva', () => {
  it('sin borrador devuelve valores neutros', () => {
    expect(datosDeReserva(undefined)).toEqual({
      presetLocationId: null,
      locationNameSnapshot: null,
      locationAddressSnapshot: null,
      customerTransportCharge: 0,
      duracionIndefinida: false,
      trioConfirmado: false,
      trioNombre: null,
      trioTarifaCombinada: null,
      tipoAgenda: 'inmediato',
      fechaProgramada: null,
      bookingSessionId: null,
    });
  });

  it('solo da el trio por confirmado cuando el jefe lo confirmo', () => {
    expect(datosDeReserva({ trioStatus: 'confirmed' }).trioConfirmado).toBe(
      true,
    );
    expect(datosDeReserva({ trioStatus: 'pending_boss' }).trioConfirmado).toBe(
      false,
    );
  });

  it('conserva la cita programada', () => {
    const datos = datosDeReserva({
      tipoAgenda: 'programado',
      fechaProgramada: '2026-09-01T20:00:00.000Z',
    });
    expect(datos.tipoAgenda).toBe('programado');
    expect(datos.fechaProgramada).toBe('2026-09-01T20:00:00.000Z');
  });
});
