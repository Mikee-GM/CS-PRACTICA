import {
  jefeAlcanzaModelo,
  modeloAlAlcance,
  modelosAlAlcance,
  type ModeloConJefes,
} from './alcance-del-jefe';

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

describe('modelosAlAlcance y modeloAlAlcance', () => {
  const propia = modelo();
  const ajena = modelo({
    id: 'empleada-2',
    jefeId: 'otro-principal',
    jefeSecundarioId: null,
    jefe: atiende('otro-principal'),
    jefeSecundario: null,
  });
  const repo = () => ({
    find: jest.fn().mockResolvedValue([propia, ajena]),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve([propia, ajena].find((m) => m.id === where.id) ?? null),
    ),
  });

  it('el admin alcanza todas sin consultar; un jefe, solo las suyas; otro rol, ninguna', async () => {
    const empleadas = repo();
    await expect(
      modelosAlAlcance(empleadas as never, { id: 'a', rol: 'admin' }),
    ).resolves.toBeNull();
    expect(empleadas.find).not.toHaveBeenCalled();
    await expect(
      modelosAlAlcance(empleadas as never, { id: 'principal', rol: 'jefe' }),
    ).resolves.toEqual(['empleada-1']);
    await expect(
      modelosAlAlcance(empleadas as never, { id: 'x', rol: 'empleada' }),
    ).resolves.toEqual([]);
  });

  it('una modelo concreta: admin si existe, jefe segun la regla, inexistente nunca', async () => {
    const empleadas = repo();
    const admin = { id: 'a', rol: 'admin' as const };
    const jefe = { id: 'principal', rol: 'jefe' as const };

    await expect(
      modeloAlAlcance(empleadas as never, admin, 'empleada-2'),
    ).resolves.toBe(true);
    await expect(
      modeloAlAlcance(empleadas as never, admin, 'no-existe'),
    ).resolves.toBe(false);
    await expect(
      modeloAlAlcance(empleadas as never, jefe, 'empleada-1'),
    ).resolves.toBe(true);
    await expect(
      modeloAlAlcance(empleadas as never, jefe, 'empleada-2'),
    ).resolves.toBe(false);
    await expect(
      modeloAlAlcance(
        empleadas as never,
        { id: 'c', rol: 'cliente' },
        'empleada-1',
      ),
    ).resolves.toBe(false);
  });
});
