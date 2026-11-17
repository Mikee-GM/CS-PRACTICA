import {
  clienteHabloDeFechaOHora,
  duracionCorroborada,
  leerMarcaDeDatos,
  marcaDeGrupo,
  pagoDichoPorElCliente,
} from './marcas-de-control';

describe('leerMarcaDeDatos', () => {
  it('lee los campos validos y anula los que no lo son', () => {
    expect(
      leerMarcaDeDatos(
        'Listo [DATA: {"duracion": "2", "pago": "bitcoin", "ubicacionPreestablecida": " Montecarlo ", "fechaProgramada": null}]',
      ),
    ).toEqual({
      duracion: 2,
      pago: null,
      ubicacionPreestablecida: 'Montecarlo',
      fechaProgramada: null,
    });
  });

  it('entiende la duracion indefinida y descarta horas absurdas', () => {
    expect(
      leerMarcaDeDatos(
        '[DATA: {"duracion": "indefinida", "pago": "efectivo"}]',
      ),
    ).toMatchObject({ duracion: 'indefinida', pago: 'efectivo' });
    expect(leerMarcaDeDatos('[DATA: {"duracion": 48}]')?.duracion).toBeNull();
  });

  it('sin marca o con JSON roto devuelve null', () => {
    expect(leerMarcaDeDatos('hola')).toBeNull();
    expect(leerMarcaDeDatos('[DATA: {duracion: 2}]')).toBeNull();
  });
});

describe('marcaDeGrupo', () => {
  it('distingue grupal de incierta', () => {
    expect(marcaDeGrupo('[GROUP_INTENT]')).toBe('grupal');
    expect(marcaDeGrupo('[GROUP_UNCLEAR]')).toBe('incierta');
    expect(marcaDeGrupo('hola')).toBeNull();
  });
});

describe('duracionCorroborada', () => {
  it('acepta lo que entienden los extractores y la cantidad en letra con unidad', () => {
    expect(duracionCorroborada(['quiero 3 horas'], 3)).toBe(true);
    expect(duracionCorroborada(['3'], 3)).toBe(true);
    expect(duracionCorroborada(['un par de horitas'], 2)).toBe(true);
    expect(duracionCorroborada(['dos'], 2)).toBe(true);
    expect(duracionCorroborada(['sin limite de tiempo'], 'indefinida')).toBe(
      true,
    );
  });

  it('no acepta un numero que el cliente no dijo', () => {
    expect(duracionCorroborada(['hola, qué tal'], 3)).toBe(false);
    expect(duracionCorroborada(['quiero 2 horas'], 3)).toBe(false);
    // "una" suelta aparece en cualquier frase.
    expect(duracionCorroborada(['tengo una pregunta'], 1)).toBe(false);
    expect(duracionCorroborada(['quiero 2 horas'], 'indefinida')).toBe(false);
  });
});

describe('pagoDichoPorElCliente', () => {
  it('vale el ultimo metodo que dijo', () => {
    expect(
      pagoDichoPorElCliente(['en efectivo', 'mejor por transferencia']),
    ).toBe('transferencia');
    expect(pagoDichoPorElCliente(['hola'])).toBeUndefined();
  });
});

describe('clienteHabloDeFechaOHora', () => {
  it('reconoce dias y horas', () => {
    expect(clienteHabloDeFechaOHora(['mañana a las 9'])).toBe(true);
    expect(clienteHabloDeFechaOHora(['el viernes'])).toBe(true);
    expect(clienteHabloDeFechaOHora(['a las 22:30'])).toBe(true);
    expect(clienteHabloDeFechaOHora(['quiero 2 horas'])).toBe(false);
  });
});
