import { BadRequestException, ConflictException } from '@nestjs/common';
import { periodoDeConciliacion } from './conciliacion.service';
import { LiquidationsService } from './liquidations.service';

/**
 * El dinero se suma en centavos enteros. Con `Number`, 0.1 + 0.2 vale
 * 0.30000000000000004: un abono que dejaba la deuda exactamente en cero se
 * rechazaba por pasarse de un residuo que no existe, y una obligacion podia
 * quedarse en `pendiente` con saldo cero.
 */
describe('abonos de una deuda: aritmetica en centavos', () => {
  function crear(importes: { deuda: number; pagado: number[] }) {
    const pagos = importes.pagado.map((amount, i) => ({
      id: `p-${i}`,
      amount,
      deletedAt: null,
    }));
    const deuda = {
      id: 'd-1',
      amount: importes.deuda,
      status: 'pending',
      payments: pagos,
    };
    const manager = {
      getRepository: (entidad: { name?: string }) =>
        entidad?.name === 'LiquidationDebt'
          ? {
              findOne: jest.fn().mockResolvedValue(deuda),
              save: jest.fn((valor: unknown) => valor),
            }
          : {
              create: (valor: Record<string, unknown>) => valor,
              save: jest.fn((valor: Record<string, unknown>) =>
                Promise.resolve({ id: 'nuevo', ...valor }),
              ),
            },
    };
    const service = Object.create(LiquidationsService.prototype) as LiquidationsService;
    Object.assign(service, {
      dataSource: {
        transaction: (fn: (m: unknown) => unknown) => fn(manager),
      },
    });
    jest
      .spyOn(service as any, 'assertEmployeeAccess')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'auditWithManager').mockResolvedValue(undefined);
    return { service, deuda };
  }

  const actor = { id: 'admin-1', rol: 'admin' } as any;

  it('acepta el ultimo abono que deja la deuda exactamente en cero', async () => {
    // 0.1 + 0.2 > 0.3 en coma flotante: este abono se rechazaba.
    const { service, deuda } = crear({ deuda: 0.3, pagado: [0.1] });

    await service.addPayment('e-1', 'd-1', { amount: 0.2 } as any, actor);

    expect(deuda.status).toBe('paid');
  });

  it('sigue rechazando un abono que se pasa del saldo, aunque sea por un centavo', async () => {
    const { service } = crear({ deuda: 100, pagado: [99.99] });

    await expect(
      service.addPayment('e-1', 'd-1', { amount: 0.02 } as any, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deja la deuda pendiente si todavia falta un centavo', async () => {
    const { service, deuda } = crear({ deuda: 100, pagado: [99.98] });

    await service.addPayment('e-1', 'd-1', { amount: 0.01 } as any, actor);

    expect(deuda.status).toBe('pending');
  });
});

describe('periodoDeConciliacion', () => {
  it('sin parametros toma la semana en curso, de lunes a domingo', () => {
    // 2026-11-25 es miercoles; la semana operativa va del 23 al 29.
    const p = periodoDeConciliacion(
      undefined,
      undefined,
      new Date('2026-11-25T18:00:00Z'),
    );

    expect(p.from).toBe('2026-11-23');
    expect(p.to).toBe('2026-11-29');
  });

  it('el fin es inclusivo: la consulta termina a medianoche del dia siguiente', () => {
    const p = periodoDeConciliacion('2026-11-23', '2026-11-29');

    // Medianoche de Mexico del 30 de noviembre = 06:00 UTC.
    expect(p.hasta.toISOString()).toBe('2026-11-30T06:00:00.000Z');
    expect(p.desde.toISOString()).toBe('2026-11-23T06:00:00.000Z');
  });

  it.each([
    ['2026-02-31', '2026-03-05'],
    ['2026-11-16T00:00:00.000Z', '2026-11-30'],
    ['no-es-fecha', '2026-11-30'],
    ['2026-11-30', '2026-11-16'],
  ])('rechaza el periodo %s a %s', (from, to) => {
    expect(() => periodoDeConciliacion(from, to)).toThrow(BadRequestException);
  });
});
