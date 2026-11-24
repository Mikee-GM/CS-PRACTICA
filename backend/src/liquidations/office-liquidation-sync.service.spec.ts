import { OfficeLiquidationSyncService } from './office-liquidation-sync.service';

/**
 * El corte de oficina suma importes de Uber y extras de cada servicio. Se hace
 * en centavos enteros: con flotantes, `0.1 + 0.2` dejaba una deuda de efectivo
 * un centavo fuera de lo que la oficina tenia en su hoja.
 */
describe('OfficeLiquidationSyncService.syncOfficeRecord', () => {
  const records = {
    findOne: jest.fn(),
    create: jest.fn((valor: object) => valor),
    merge: jest.fn(),
    save: jest.fn((valor: object) => Promise.resolve(valor)),
    findOneOrFail: jest.fn().mockResolvedValue({ id: 'registro' }),
    // Ninguna semana confirmada: el servicio entra con la fecha en que termino.
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const cashObligations = {
    findOneBy: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const services = { findOne: jest.fn() };

  const service = new OfficeLiquidationSyncService(
    services as never,
    records as never,
    cashObligations as never,
  );

  const servicioEnEfectivo = () => ({
    id: 'svc-1',
    estado: 'finalizado',
    horaFinServicio: new Date('2026-09-10T20:00:00Z'),
    empleadaId: 'emp-1',
    jefeId: 'jefe-1',
    jefe: { rol: 'jefe' },
    metodoPago: 'efectivo',
    serviceType: 'individual',
    totalBase: '100.00',
    totalExtras: '0.00',
    totalFinal: '0.30',
    extrasServicios: [],
    participantes: [],
    viajes: [
      {
        tipo: 'regreso',
        proveedorTransporte: 'uber',
        estado: 'finalizado',
        fareConfirmedAt: new Date(),
        tarifa: '0.10',
      },
      {
        tipo: 'ida',
        proveedorTransporte: 'uber',
        estado: 'finalizado',
        fareConfirmedAt: new Date(),
        tarifa: '0.20',
      },
    ],
  });

  beforeEach(() => jest.clearAllMocks());

  it('descuenta el Uber de la deuda de efectivo sin arrastrar error de flotante', async () => {
    services.findOne.mockResolvedValue(servicioEnEfectivo());
    records.findOne.mockResolvedValue(null);

    await service.syncOfficeRecord('svc-1');

    const [obligacion] = cashObligations.upsert.mock.calls[0];
    // 0.30 - (0.10 + 0.20) = 0 exacto; en flotante sobraba 5.5e-17.
    expect(obligacion.amount).toBe(0);
    expect(obligacion.uberDeduction).toBe(0.3);
  });
});
