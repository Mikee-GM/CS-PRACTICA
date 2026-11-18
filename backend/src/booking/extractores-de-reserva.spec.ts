import {
  buildModelKeys,
  detectGroupServiceIntent,
  detectOpenEndedDuration,
  extractHireDuration,
  extractHirePaymentMethod,
} from './extractores-de-reserva';

/*
 * Pruebas directas de los extractores. Los casos de conversacion completos
 * siguen en las pruebas del servicio de reserva.
 */

describe('extractHireDuration', () => {
  it.each([
    ['2', 2],
    ['3 horas', 3],
    ['quiero 2hrs', 2],
    ['dos horas', 2],
    ['llego a las 9, quiero 3 horas', 3],
  ])('"%s" son %s horas', (texto, horas) => {
    expect(extractHireDuration(texto)).toBe(horas);
  });

  it.each(['carrera 15', 'a las 10', '2.5 horas', '25 horas', '0'])(
    '"%s" no es una duracion',
    (texto) => {
      expect(extractHireDuration(texto)).toBeUndefined();
    },
  );
});

describe('extractHirePaymentMethod', () => {
  it.each([
    ['pago en efectivo', 'efectivo'],
    ['con TARJETA', 'tarjeta'],
    ['te hago transferencia', 'transferencia'],
    ['mixto, efectivo y transferencia', 'mixto'],
  ])('"%s" es %s', (texto, metodo) => {
    expect(extractHirePaymentMethod(texto)).toBe(metodo);
  });

  it('sin metodo devuelve undefined', () => {
    expect(extractHirePaymentMethod('luego te digo')).toBeUndefined();
  });
});

describe('detectGroupServiceIntent', () => {
  it.each([
    ['quiero un servicio grupal', 'grupal'],
    ['tres chicas para una despedida', 'grupal'],
    ['puede venir otra chica mas?', 'incierta'],
    ['quiero verte a ti', 'individual'],
  ])('"%s" es %s', (texto, intencion) => {
    expect(detectGroupServiceIntent(texto)).toBe(intencion);
  });
});

describe('detectOpenEndedDuration', () => {
  it.each(['servicio abierto', 'tiempo indefinido', 'sin limite'])(
    '"%s" es duracion abierta',
    (texto) => {
      expect(detectOpenEndedDuration(texto)).toBe(true);
    },
  );

  it.each(['el motel esta abierto?', 'eres abierta?'])(
    '"%s" no habla de duracion',
    (texto) => {
      expect(detectOpenEndedDuration(texto)).toBe(false);
    },
  );
});

describe('buildModelKeys', () => {
  it('numera con el prefijo y sin exponer el id', () => {
    const claves = buildModelKeys(
      [
        { id: 'uuid-a', nombre: 'Ana' },
        { id: 'uuid-b', nombre: 'Bea' },
      ],
      'M',
    );
    expect(claves.map((c) => c.clave)).toEqual(['M1', 'M2']);
    expect(claves[1].model.nombre).toBe('Bea');
  });
});
