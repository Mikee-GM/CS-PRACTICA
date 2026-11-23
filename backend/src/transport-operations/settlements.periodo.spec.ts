import { BadRequestException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';

/**
 * El reporte de liquidaciones de choferes recibia una fecha ISO completa o una
 * fecha imposible y respondia 500 (`Invalid time value`). Tiene que ser 400.
 */
describe('SettlementsService.ventanaDeSemana: periodo invalido', () => {
  const service = Object.create(SettlementsService.prototype) as SettlementsService;
  const ventana = (a: string, b: string) =>
    (
      service as unknown as {
        ventanaDeSemana: (x: string, y: string) => unknown;
      }
    ).ventanaDeSemana(a, b);

  it('acepta un periodo AAAA-MM-DD', () => {
    expect(() => ventana('2026-11-16', '2026-11-22')).not.toThrow();
  });

  it.each([
    ['2026-11-16T00:00:00.000Z', '2026-11-30T00:00:00.000Z'],
    ['2026-02-31', '2026-03-01'],
    ['2026-11-16', 'no-es-fecha'],
    ['', ''],
  ])('rechaza %s a %s con 400', (inicio, fin) => {
    expect(() => ventana(inicio, fin)).toThrow(BadRequestException);
  });
});
