import { REGLAS_PERMANENTES_WEB } from './prompts/prompts';
import { PALABRAS_VETADAS_WEB, palabrasVetadasEn } from './vocabulario-vetado';

describe('palabrasVetadasEn', () => {
  it('encuentra las palabras sin importar mayusculas ni acentos', () => {
    expect(palabrasVetadasEn('Lo vera el Jefe en la aplicacion')).toEqual([
      'aplicación',
      'jefe',
    ]);
  });

  it('solo cuenta palabras completas', () => {
    expect(palabrasVetadasEn('Mi jefecita del apparel, sin sistemas')).toEqual(
      [],
    );
  });

  it('un texto limpio no tiene ninguna', () => {
    expect(palabrasVetadasEn('Ya llegué, aquí te espero')).toEqual([]);
  });
});

describe('PALABRAS_VETADAS_WEB en el prompt web', () => {
  it('el prompt web enumera exactamente la lista compartida', () => {
    const prompt = REGLAS_PERMANENTES_WEB;
    const enumeracion = PALABRAS_VETADAS_WEB.map((p) => `"${p}"`).join(', ');
    expect(prompt).toContain(
      `PROHIBIDO usar, escribir o insinuar las palabras: ${enumeracion} o cualquier`,
    );
  });
});
