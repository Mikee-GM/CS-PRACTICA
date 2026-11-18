import { palabrasVetadasEn } from '../ai/vocabulario-vetado';
import { ServicesService } from './services.service';

/**
 * Los avisos del ciclo de vida del servicio llegan tambien al chat web.
 *
 * Quien reservo desde la web tiene que saber si su servicio se acepto, se
 * rechazo o cambio de hora.
 */
describe('ServicesService: avisos al chat web del cliente', () => {
  const conversationNotifier = { notifyClient: jest.fn() };
  const aiMessageService = {
    generate: jest.fn(),
    generateAgencyMessage: jest.fn(),
  };
  const notificationsService = { notificar: jest.fn() };
  const realtime = { emitToBoss: jest.fn() };
  const usuariosRepository = { findOne: jest.fn() };
  const serviciosRepository = {
    update: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn((valor: unknown) => valor),
    manager: { getRepository: jest.fn() },
  };

  const service = Object.create(ServicesService.prototype) as ServicesService;
  Object.assign(service, {
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    conversationNotifier,
    aiMessageService,
    notificationsService,
    realtimeEventsService: realtime,
    usuariosRepository,
    serviciosRepository,
    choferesRepository: { findOne: jest.fn() },
    configService: { get: jest.fn() },
  });

  const clienteWeb = { id: 'cli-web', usuarioId: 'usr-cliente' };

  function servicio(cliente: Record<string, unknown>, extra = {}): any {
    return {
      id: 'svc-1',
      clienteId: cliente.id,
      cliente,
      empleadaId: 'emp-1',
      empleada: { nombreArtistico: 'Valentina', usuarioId: null },
      jefeId: 'jefe-1',
      fechaProgramada: new Date('2026-11-20T21:00:00Z'),
      ...extra,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    conversationNotifier.notifyClient.mockResolvedValue(true);
    aiMessageService.generate.mockResolvedValue('Qué pena contigo \u{1F614}');
    aiMessageService.generateAgencyMessage.mockResolvedValue(
      'La nueva hora de llegada es 9:30.',
    );
    notificationsService.notificar.mockResolvedValue(1);
  });

  describe('reprogramacion', () => {
    it('el cliente web recibe el cambio de hora en el chat web', async () => {
      await (service as any).avisarDeLaReprogramacion(
        servicio(clienteWeb),
        null,
        true,
      );

      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId: 'cli-web',
          serviceId: 'svc-1',
          employeeId: 'emp-1',
          texto: expect.stringContaining('nuestra cita con Valentina'),
        }),
      );
    });

    it('si el jefe pide no avisar, tampoco avisa por la web', async () => {
      await (service as any).avisarDeLaReprogramacion(
        servicio(clienteWeb),
        null,
        false,
      );

      expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
    });
  });

  describe('cancelacion manual', () => {
    it('el cliente web recibe el mismo texto de la IA sin emojis', async () => {
      await (service as any).notifyServiceCancelled(
        servicio(clienteWeb),
        'pendiente',
        [],
      );

      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({ texto: 'Qué pena contigo' }),
      );
    });

    it('un fallo del chat web no rompe la cancelacion', async () => {
      conversationNotifier.notifyClient.mockRejectedValueOnce(
        new Error('base caida'),
      );

      await expect(
        (service as any).notifyServiceCancelled(
          servicio(clienteWeb),
          'pendiente',
          [],
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('rechazo del jefe', () => {
    const jefe = { id: 'jefe-1', rol: 'jefe' };

    beforeEach(() => {
      Object.assign(service, {
        transicionarEstado: jest.fn().mockResolvedValue(true),
        assertActorCanManageService: jest.fn(),
      });
      serviciosRepository.manager.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(jefe),
        update: jest.fn(),
      });
    });

    it('el cliente web se entera del rechazo por el chat', async () => {
      serviciosRepository.findOne
        .mockResolvedValueOnce(servicio(clienteWeb, { estado: 'pendiente' }))
        .mockResolvedValueOnce(null);

      await service.rechazar('svc-1', 'jefe-1');

      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId: 'cli-web',
          texto: 'Qué pena contigo',
        }),
      );
    });
  });

  describe('nueva hora de llegada por la cita anterior', () => {
    function encadenado(cliente: Record<string, unknown>) {
      serviciosRepository.findOneBy.mockResolvedValue({
        id: 'svc-0',
        horaInicioServicio: new Date('2026-11-20T18:00:00Z'),
        duracionPactadaHoras: 2,
      });
      serviciosRepository.findOne.mockResolvedValue(servicio(cliente));
    }

    it('el cliente web recibe el aviso de la agencia', async () => {
      encadenado(clienteWeb);

      await service.recalculateScheduledSuccessor('svc-0');

      expect(conversationNotifier.notifyClient).toHaveBeenCalledWith(
        expect.objectContaining({
          texto: 'La nueva hora de llegada es 9:30.',
        }),
      );
    });
  });

  describe('cuenta final de un servicio abierto', () => {
    const cuentas = '1. Banco Uno\nTitular: Ana Perez\nCLABE: 0123456789';

    beforeEach(() => {
      Object.assign(service, {
        bankTransferDetails: jest.fn().mockResolvedValue(cuentas),
      });
    });

    const pedir = (cliente: Record<string, unknown>, extra = {}) =>
      (service as any).requestOpenEndedFinalPayment(
        servicio(cliente, { totalFinal: 1500, ...extra }),
        3,
        '2 h 40 min',
      );

    it('el cliente web recibe el total y las cuentas, sin formato ni emojis', async () => {
      await pedir(clienteWeb, { metodoPago: 'transferencia' });

      const { texto } = conversationNotifier.notifyClient.mock.calls[0][0];
      expect(texto).toContain('Total a pagar: $1,500.00');
      expect(texto).toContain('Horas cobradas: 3 horas');
      expect(texto).toContain('CLABE: 0123456789');
      expect(texto).toContain('del comprobante');
      expect(texto).not.toMatch(/[*\p{Extended_Pictographic}]/u);
      expect(palabrasVetadasEn(texto)).toEqual([]);
    });

    it('deja marcado el cobro pendiente', async () => {
      await pedir(clienteWeb, { metodoPago: 'transferencia' });

      expect(serviciosRepository.update).toHaveBeenCalledWith('svc-1', {
        cobroFinalPendiente: true,
      });
    });

    it('en efectivo avisa el total sin pedir comprobante ni marcar nada', async () => {
      await pedir(clienteWeb, { metodoPago: 'efectivo' });

      const { texto } = conversationNotifier.notifyClient.mock.calls[0][0];
      expect(texto).toContain('Total a pagar');
      expect(texto).not.toContain('comprobante');
      expect(serviciosRepository.update).not.toHaveBeenCalled();
    });

    it('si una cuenta trae una palabra vetada, la web cae al texto sin cuentas', async () => {
      (service as any).bankTransferDetails.mockResolvedValue(
        'Titular: Agencia Uno CLABE 0123',
      );

      await pedir(clienteWeb, { metodoPago: 'transferencia' });

      const { texto } = conversationNotifier.notifyClient.mock.calls[0][0];
      expect(texto).toContain('Total a pagar');
      expect(texto).toContain('te paso los datos');
      expect(palabrasVetadasEn(texto)).toEqual([]);
    });

    it('sin cuenta web no hace nada', async () => {
      await pedir(
        { id: 'cli-x', usuarioId: null },
        { metodoPago: 'transferencia' },
      );

      expect(conversationNotifier.notifyClient).not.toHaveBeenCalled();
      expect(serviciosRepository.update).not.toHaveBeenCalled();
    });
  });
});
