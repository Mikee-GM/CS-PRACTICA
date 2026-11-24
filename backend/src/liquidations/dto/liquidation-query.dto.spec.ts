import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { fechaDelNegocio } from '../../common/locale';
import { LiquidationPeriodQueryDto } from './liquidation-query.dto';

/**
 * Las fechas planas son dias del calendario de Mexico. Antes se tomaban como
 * medianoche UTC y el corte semanal del Centro de Mando perdia desde el sabado por
 * la tarde.
 */
describe('LiquidationPeriodQueryDto: periodo en fechas planas o en instantes', () => {
  const periodo = (startDate: string, endDate: string) =>
    plainToInstance(LiquidationPeriodQueryDto, { startDate, endDate });

  it('una fecha plana de inicio es la medianoche de Mexico, no la de UTC', () => {
    const dto = periodo('2026-11-23', '2026-11-29');

    expect(dto.startDate.toISOString()).toBe('2026-11-23T06:00:00.000Z');
  });

  it('una fecha plana de fin es el ultimo milisegundo de ese dia en Mexico', () => {
    const dto = periodo('2026-11-23', '2026-11-29');

    expect(dto.endDate.toISOString()).toBe('2026-11-30T05:59:59.999Z');
    // El domingo completo cabe: el sabado 28 a las 21:00 de Mexico tambien.
    expect(new Date('2026-11-29T03:00:00.000Z').getTime()).toBeLessThan(
      dto.endDate.getTime(),
    );
  });

  it('un instante completo se respeta tal cual', () => {
    const dto = periodo('2026-11-23T06:00:00.000Z', '2026-11-30T05:59:59.999Z');

    expect(dto.startDate.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(dto.endDate.toISOString()).toBe('2026-11-30T05:59:59.999Z');
  });

  it('las dos formas dan la misma semana, y el corte se busca por el lunes correcto', () => {
    const plano = periodo('2026-11-23', '2026-11-29');
    const instante = periodo(
      '2026-11-23T06:00:00.000Z',
      '2026-11-30T05:59:59.999Z',
    );

    expect(plano.startDate.getTime()).toBe(instante.startDate.getTime());
    expect(plano.endDate.getTime()).toBe(instante.endDate.getTime());
    expect(fechaDelNegocio(plano.startDate)).toBe('2026-11-23');
    expect(fechaDelNegocio(plano.endDate)).toBe('2026-11-29');
  });

  it('rechaza una fecha que no existe o un texto cualquiera', async () => {
    for (const mala of ['no-es-fecha', '2026-02-31x']) {
      const errores = await validate(periodo(mala, '2026-11-29'));
      expect(errores.map((e) => e.property)).toContain('startDate');
    }
  });
});
