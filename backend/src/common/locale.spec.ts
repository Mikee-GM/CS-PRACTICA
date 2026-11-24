import {
  desdeHoraDelNegocio,
  enHoraDelNegocio,
  fechaDelNegocio,
} from './locale';

/**
 * La hora pactada por chat llega como texto sin zona, y eso ya costo una cita:
 * "manana a las 2 pm" se guardo como las 8 de la manana porque el servidor de
 * produccion corre en UTC y `new Date` lee un texto sin zona como hora local.
 */
describe('desdeHoraDelNegocio', () => {
  const zonaOriginal = process.env.TZ;

  afterEach(() => {
    process.env.TZ = zonaOriginal;
  });

  it('interpreta un texto sin zona como hora de Mexico', () => {
    const instante = desdeHoraDelNegocio('2026-09-21T14:00:00');

    expect(instante).not.toBeNull();
    expect(
      instante!.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
    ).toBe('21/9/2026, 2:00:00 p.m.');
  });

  it('da el mismo instante corra el servidor donde corra', () => {
    const enUtc = desdeHoraDelNegocio('2026-09-21T14:00:00')!.getTime();

    // El mismo texto, leido por un proceso con otra zona del sistema.
    process.env.TZ = 'Asia/Tokyo';
    const enTokio = desdeHoraDelNegocio('2026-09-21T14:00:00')!.getTime();

    expect(enTokio).toBe(enUtc);
  });

  it('es el inverso de enHoraDelNegocio', () => {
    const instante = desdeHoraDelNegocio('2026-09-21T14:30:15')!;
    const leido = enHoraDelNegocio(instante);

    expect(leido.toISOString()).toBe('2026-09-21T14:30:15.000Z');
  });

  it('respeta un texto que ya trae zona', () => {
    const instante = desdeHoraDelNegocio('2026-09-21T14:00:00Z');

    expect(instante!.toISOString()).toBe('2026-09-21T14:00:00.000Z');
  });

  it('acepta un texto sin segundos, como el que da datetime-local', () => {
    const instante = desdeHoraDelNegocio('2026-09-21T14:00');

    expect(
      instante!.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
    ).toBe('21/9/2026, 2:00:00 p.m.');
  });

  it('devuelve null en vez de una fecha invalida silenciosa', () => {
    expect(desdeHoraDelNegocio('manana a las dos')).toBeNull();
    expect(desdeHoraDelNegocio('')).toBeNull();
  });
});

describe('fechaDelNegocio', () => {
  it('da la fecha de Mexico, no la de UTC', () => {
    // Domingo 29 de noviembre a las 23:59:59.999 en Mexico = lunes 30 en UTC.
    const finDeSemana = new Date('2026-11-30T05:59:59.999Z');

    expect(finDeSemana.toISOString().slice(0, 10)).toBe('2026-11-30');
    expect(fechaDelNegocio(finDeSemana)).toBe('2026-11-29');
  });

  it('el inicio de la semana (lunes 00:00 de Mexico) sigue siendo lunes', () => {
    expect(fechaDelNegocio(new Date('2026-11-23T06:00:00.000Z'))).toBe(
      '2026-11-23',
    );
  });

  it('un servicio de la noche cuenta en el dia en que ocurrio', () => {
    // Sabado 28 a las 21:30 en Mexico = domingo 29 a las 03:30 en UTC.
    expect(fechaDelNegocio(new Date('2026-11-29T03:30:00.000Z'))).toBe(
      '2026-11-28',
    );
  });
});
