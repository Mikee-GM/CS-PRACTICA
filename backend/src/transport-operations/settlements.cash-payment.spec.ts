import { BadRequestException } from '@nestjs/common';
import { EmployeeCashObligation } from './entities/employee-cash-obligation.entity';
import {
  EmployeeCashPayment,
  EmployeeCashPaymentAllocation,
} from './entities/employee-cash-payment.entity';
import { SettlementsService } from './settlements.service';
import type { Usuarios } from '../users/entities/user.entity';

/**
 * Abono de efectivo: la aritmetica va en centavos enteros y la semana de un
 * chofer se cuenta en hora de Mexico.
 */
const admin = { id: 'admin-1', rol: 'admin' } as Usuarios;

function armarServicio(obligaciones: Array<Record<string, unknown>>) {
  const asignaciones: Array<Record<string, unknown>> = [];
  const manager = {
    getRepository(entidad: unknown) {
      if (entidad === EmployeeCashObligation) {
        return { find: () => Promise.resolve(obligaciones) };
      }
      if (entidad === EmployeeCashPayment) {
        return {
          save: (fila: Record<string, unknown>) =>
            Promise.resolve({ id: 'pago-1', ...fila }),
        };
      }
      if (entidad === EmployeeCashPaymentAllocation) {
        return {
          save: (fila: Record<string, unknown>) => {
            asignaciones.push(fila);
            return Promise.resolve(fila);
          },
        };
      }
      throw new Error('repositorio inesperado');
    },
    save: (fila: unknown) => Promise.resolve(fila),
  };
  const service = Object.create(
    SettlementsService.prototype,
  ) as SettlementsService;
  Object.assign(service, {
    dataSource: {
      transaction: (trabajo: (m: typeof manager) => unknown) =>
        trabajo(manager),
    },
  });
  jest
    .spyOn(
      service as unknown as { assertEmployeeAccess: () => Promise<void> },
      'assertEmployeeAccess',
    )
    .mockResolvedValue(undefined);
  return { service, asignaciones };
}

describe('SettlementsService.registerCashPayment', () => {
  it('liquida dos obligaciones con un abono por el saldo exacto', async () => {
    // 0.1 + 0.2 en flotante es 0.30000000000000004: el abono de 0.3 salia
    // rechazado o dejaba la segunda obligacion a un centavo de pagarse.
    const obligaciones = [
      { id: 'o1', amount: '0.10', paidAmount: '0' },
      { id: 'o2', amount: '0.20', paidAmount: '0' },
    ];
    const { service, asignaciones } = armarServicio(obligaciones);

    const pago = await service.registerCashPayment(
      'emp-1',
      0.3,
      undefined,
      admin,
    );

    expect(obligaciones.map((o) => (o as { status?: string }).status)).toEqual([
      'paid',
      'paid',
    ]);
    expect(asignaciones.map((a) => a.amount)).toEqual([0.1, 0.2]);
    // El abono registrado se devuelve a quien lo pidio.
    expect(pago).toMatchObject({ id: 'pago-1', amount: 0.3 });
  });

  it('rechaza un abono mayor al saldo pendiente', async () => {
    const { service } = armarServicio([
      { id: 'o1', amount: '10.00', paidAmount: '4.00' },
    ]);

    await expect(
      service.registerCashPayment('emp-1', 6.01, undefined, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un abono parcial deja la obligacion pendiente con el saldo en centavos', async () => {
    const obligaciones = [{ id: 'o1', amount: '10.00', paidAmount: '0' }];
    const { service } = armarServicio(obligaciones);

    await service.registerCashPayment('emp-1', 3.33, undefined, admin);

    expect(obligaciones[0]).toMatchObject({
      paidAmount: 3.33,
      status: 'pending',
    });
  });
});

describe('SettlementsService.getWeekBounds', () => {
  const service = Object.create(
    SettlementsService.prototype,
  ) as SettlementsService;
  const semanaDe = (fecha: Date) =>
    (
      service as unknown as {
        getWeekBounds: (d: Date) => { weekStart: string; weekEnd: string };
      }
    ).getWeekBounds(fecha);

  it('el domingo por la noche en Mexico sigue siendo la semana que acaba', () => {
    // Domingo 13 de septiembre, 20:00 en Mexico: ya es lunes en UTC.
    expect(semanaDe(new Date('2026-09-14T02:00:00Z'))).toEqual({
      weekStart: '2026-09-07',
      weekEnd: '2026-09-13',
    });
  });

  it('el lunes de madrugada abre la semana nueva', () => {
    expect(semanaDe(new Date('2026-09-14T06:30:00Z'))).toEqual({
      weekStart: '2026-09-14',
      weekEnd: '2026-09-20',
    });
  });
});
