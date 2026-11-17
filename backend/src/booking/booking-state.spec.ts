import {
  estadoInicial,
  normalizarEstado,
  reiniciarReserva,
  requisitoPendiente,
} from './booking-state';

describe('booking-state', () => {
  it('un estado vacio o ilegible vuelve al inicial', () => {
    expect(normalizarEstado({})).toEqual(estadoInicial());
    expect(normalizarEstado(null)).toEqual(estadoInicial());
    expect(normalizarEstado([1, 2])).toEqual(estadoInicial());
  });

  it('corrige campos que no tienen la forma esperada', () => {
    const estado = normalizarEstado({
      lifecycle: 'INVENTADO',
      ultimaIntencion: 'OTRA',
      loopBreaker: 'x',
      fallosIaSeguidos: '3',
      ubicacion: { lat: 'a', lng: 1, origen: 'pin' },
      duracionPactadaHoras: 2,
    });
    expect(estado).toMatchObject({
      lifecycle: 'IDLE',
      ultimaIntencion: undefined,
      loopBreaker: { failureCount: 0 },
      fallosIaSeguidos: 0,
      ubicacion: undefined,
      duracionPactadaHoras: 2,
    });
  });

  it('pide horas, ubicacion y pago, en ese orden', () => {
    const estado = estadoInicial();
    expect(requisitoPendiente(estado, 'e1')).toBe('duration');
    estado.duracionPactadaHoras = 2;
    expect(requisitoPendiente(estado, 'e1')).toBe('location');
    estado.ubicacion = { lat: 1, lng: 1, origen: 'pin' };
    expect(requisitoPendiente(estado, 'e1')).toBe('payment');
    estado.metodoPago = 'efectivo';
    expect(requisitoPendiente(estado, 'e1')).toBeNull();
  });

  it('al reiniciar olvida la reserva pero no el cursor de mensajes', () => {
    const reiniciado = reiniciarReserva({
      ...estadoInicial(),
      lifecycle: 'COLLECTING',
      duracionPactadaHoras: 2,
      ultimoMensajeAtendidoId: 'm9',
      ultimoDesvio: 'Ay lindo, yo de eso ni idea',
    });
    expect(reiniciado).toMatchObject({
      lifecycle: 'IDLE',
      ultimoMensajeAtendidoId: 'm9',
      ultimoDesvio: 'Ay lindo, yo de eso ni idea',
    });
    expect(reiniciado.duracionPactadaHoras).toBeUndefined();
  });
});
