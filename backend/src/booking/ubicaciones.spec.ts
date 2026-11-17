import {
  fueraDeCobertura,
  ubicacionMencionadaEn,
  ubicacionPorNombre,
} from './ubicaciones';

const QUERETARO = { lat: 20.5888, lng: -100.3899 };
const DURANGO = { lat: 24.013241, lng: -104.639611 };

const areaQueretaro = {
  ciudad: 'Querétaro',
  centroLat: QUERETARO.lat,
  centroLng: QUERETARO.lng,
  radioKm: 45,
};

describe('fueraDeCobertura', () => {
  it('rechaza un pin de otro estado con la ciudad que si se atiende', () => {
    const rechazo = fueraDeCobertura(areaQueretaro, DURANGO.lat, DURANGO.lng);

    expect(rechazo?.ciudad).toBe('Querétaro');
    expect(rechazo?.distanciaKm).toBeGreaterThan(500);
  });

  it('acepta un pin dentro del radio', () => {
    // Juriquilla, al norte de la ciudad: unos 12 km del centro.
    expect(fueraDeCobertura(areaQueretaro, 20.7003, -100.4472)).toBeNull();
  });

  /** El borde cuenta como dentro: el radio es lo que se promete atender. */
  it('acepta un pin justo en el borde del radio', () => {
    const area = { ...areaQueretaro, radioKm: 0 };
    expect(fueraDeCobertura(area, QUERETARO.lat, QUERETARO.lng)).toBeNull();
  });
});

const MONTECARLO = { id: 'loc-1', name: 'Motel Montecarlo' };
const MAJESTIC = { id: 'loc-2', name: 'Hotel Majestic' };

describe('ubicacionPorNombre', () => {
  it('encuentra el motel por su nombre corto', () => {
    expect(ubicacionPorNombre([MONTECARLO, MAJESTIC], 'montecarlo')).toBe(
      MONTECARLO,
    );
  });

  it('encuentra el motel cuando el nombre trae palabras de mas', () => {
    expect(
      ubicacionPorNombre([MONTECARLO], 'el Motel Montecarlo del centro'),
    ).toBe(MONTECARLO);
  });

  it('no busca con un nombre vacio o que no es texto', () => {
    expect(ubicacionPorNombre([MONTECARLO], '   ')).toBeNull();
    expect(ubicacionPorNombre([MONTECARLO], 42)).toBeNull();
  });
});

describe('ubicacionMencionadaEn', () => {
  it('lo encuentra dentro de una frase, sin la palabra generica', () => {
    expect(
      ubicacionMencionadaEn([MONTECARLO], ['Quiero 3 horas en Montecarlo']),
    ).toBe(MONTECARLO);
  });

  it('no confunde el nombre con un trozo de otra palabra', () => {
    expect(
      ubicacionMencionadaEn(
        [{ id: 'loc-3', name: 'Real' }],
        ['de verdad realmente me interesa'],
      ),
    ).toBeNull();
  });

  it('se queda con el del texto mas reciente, que llega primero', () => {
    expect(
      ubicacionMencionadaEn(
        [MONTECARLO, MAJESTIC],
        ['mejor en el Majestic', 'nos vemos en Montecarlo'],
      ),
    ).toBe(MAJESTIC);
  });

  it('ignora acentos y mayusculas', () => {
    const conAcento = { id: 'loc-4', name: 'Montecarló' };
    expect(ubicacionMencionadaEn([conAcento], ['EN MONTECARLO PORFA'])).toBe(
      conAcento,
    );
  });

  it('un nombre hecho solo de palabras genericas nunca se da por elegido', () => {
    expect(
      ubicacionMencionadaEn(
        [{ id: 'loc-5', name: 'Motel Suites' }],
        ['quiero un motel suites'],
      ),
    ).toBeNull();
  });
});
