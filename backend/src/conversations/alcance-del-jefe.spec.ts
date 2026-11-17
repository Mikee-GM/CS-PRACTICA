import { jefeAlcanzaModelo, type ModeloConJefes } from './alcance-del-jefe';

const atiende = (id: string) => ({
  id,
  activo: true,
  disponible: true,
  enJornada: true,
});

function modelo(overrides: Partial<ModeloConJefes> = {}): ModeloConJefes {
  return {
    id: 'empleada-1',
    jefeId: 'principal',
    jefeSecundarioId: 'secundario',
    jefe: atiende('principal'),
    jefeSecundario: atiende('secundario'),
    ...overrides,
  };
}

describe('jefeAlcanzaModelo', () => {
  it('el principal y el secundario siempre ven los chats de su modelo', () => {
    expect(jefeAlcanzaModelo('principal', modelo())).toBe(true);
    expect(jefeAlcanzaModelo('secundario', modelo())).toBe(true);
  });

  it('otro jefe no los ve mientras alguno de los dos pueda atender', () => {
    expect(jefeAlcanzaModelo('otro', modelo())).toBe(false);
    expect(
      jefeAlcanzaModelo(
        'otro',
        modelo({ jefe: { ...atiende('principal'), enJornada: false } }),
      ),
    ).toBe(false);
  });

  it.each([
    ['inactivo', { activo: false }],
    ['no disponible', { disponible: false }],
    ['con la jornada cerrada', { enJornada: false }],
  ])('con principal y secundario %s pasa a cualquier jefe', (_caso, cambio) => {
    expect(
      jefeAlcanzaModelo(
        'otro',
        modelo({
          jefe: { ...atiende('principal'), ...cambio },
          jefeSecundario: { ...atiende('secundario'), ...cambio },
        }),
      ),
    ).toBe(true);
  });

  it('una modelo sin jefes queda al alcance de cualquier jefe', () => {
    expect(
      jefeAlcanzaModelo(
        'otro',
        modelo({
          jefeId: null,
          jefeSecundarioId: null,
          jefe: null,
          jefeSecundario: null,
        }),
      ),
    ).toBe(true);
  });
});
