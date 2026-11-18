import {
  joinServicioQueEsperaComprobante,
  servicioEsperaComprobante,
} from './comprobante-pendiente';

describe('servicioEsperaComprobante', () => {
  it('un individual lo dice con su marca de comprobante pendiente', () => {
    expect(
      servicioEsperaComprobante({
        serviceType: 'individual',
        metodoPago: 'transferencia',
        comprobantePendiente: true,
      }),
    ).toBe(true);
    expect(
      servicioEsperaComprobante({
        serviceType: 'individual',
        metodoPago: 'transferencia',
        comprobantePendiente: false,
        pendingBalance: 500,
      }),
    ).toBe(false);
  });

  it('un grupal lo dice con su saldo, solo por transferencia', () => {
    const grupal = {
      serviceType: 'grupal',
      metodoPago: 'transferencia',
      comprobantePendiente: false,
    };
    expect(
      servicioEsperaComprobante({ ...grupal, pendingBalance: '0.01' }),
    ).toBe(true);
    expect(servicioEsperaComprobante({ ...grupal, pendingBalance: 0 })).toBe(
      false,
    );
    expect(
      servicioEsperaComprobante({
        ...grupal,
        metodoPago: 'efectivo',
        pendingBalance: 900,
      }),
    ).toBe(false);
    // La marca de los individuales no cuenta en un grupal.
    expect(
      servicioEsperaComprobante({
        ...grupal,
        comprobantePendiente: true,
        pendingBalance: 0,
      }),
    ).toBe(false);
  });
});

describe('joinServicioQueEsperaComprobante', () => {
  it('lleva la misma condicion para individuales y grupales', () => {
    const sql = joinServicioQueEsperaComprobante('sc', 'c', '$4', '$5');
    expect(sql).toContain("sc.service_type <> 'grupal'");
    expect(sql).toContain('sc.comprobante_pendiente = true');
    expect(sql).toContain("sc.service_type = 'grupal'");
    expect(sql).toContain("sc.metodo_pago::text = 'transferencia'");
    expect(sql).toContain('sc.pending_balance > 0');
    expect(sql).toContain('ANY($4::text[])');
    expect(sql).toContain('ALL($5::text[])');
  });
});
