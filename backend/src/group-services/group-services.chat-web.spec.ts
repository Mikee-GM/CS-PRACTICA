import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GroupServicesService } from './group-services.service';

const CONVERSACION = '11111111-1111-4111-8111-111111111111';
const JEFE = { id: 'jefe-1', rol: 'jefe' } as const;

/**
 * Servicio grupal del chat web (Fase 5, decision 6): la solicitud nace de una
 * conversacion y lo que Telegram le mandaba al cliente sale por ese chat. El
 * bot no debe tocarse en ningun camino web.
 */
describe('GroupServicesService en el chat web', () => {
  let service: any;
  let bot: { telegram: { sendMessage: jest.Mock } };
  let grupoWeb: Record<string, jest.Mock>;
  let requests: Record<string, jest.Mock>;
  let realtime: { emitToBoss: jest.Mock; emitToEmployee: jest.Mock };
  let notifications: { notificar: jest.Mock };

  const solicitudWeb = {
    id: 'solicitud-1',
    clientId: 'cliente-1',
    bossId: 'jefe-1',
    serviceId: null,
    conversationId: CONVERSACION,
    status: 'esperando_jefe',
    locationReference: null,
    client: { telegramChatId: null },
  };

  beforeEach(() => {
    bot = { telegram: { sendMessage: jest.fn() } };
    grupoWeb = {
      conversacionParaGrupo: jest.fn().mockResolvedValue({
        id: CONVERSACION,
        clientId: 'cliente-1',
        employeeId: 'empleada-1',
        mode: 'AI_ACTIVE',
      }),
      tomarControl: jest.fn().mockResolvedValue(undefined),
      pedidosPendientes: jest.fn().mockResolvedValue([]),
      mensajes: jest.fn().mockResolvedValue([{ id: 'm1' }]),
      escribirDelJefe: jest
        .fn()
        .mockResolvedValue({ id: 'm2', emisor: 'jefe', mensaje: 'Hola' }),
      pedirUbicacion: jest.fn().mockResolvedValue(undefined),
      ultimaUbicacionDelCliente: jest.fn().mockResolvedValue(null),
      avisarCotizacion: jest.fn().mockResolvedValue(undefined),
      avisarSaldo: jest.fn().mockResolvedValue(undefined),
      avisarComprobanteRechazado: jest.fn().mockResolvedValue(undefined),
    };
    requests = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue({ ...solicitudWeb }),
      save: jest.fn((r: object) => Promise.resolve(r)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    realtime = { emitToBoss: jest.fn(), emitToEmployee: jest.fn() };
    notifications = { notificar: jest.fn().mockResolvedValue(1) };

    service = Object.create(GroupServicesService.prototype);
    Object.assign(service, {
      bot,
      grupoWeb,
      requests,
      realtime,
      notifications,
      logger: { warn: jest.fn(), error: jest.fn() },
      bossAssignment: { resolve: jest.fn().mockResolvedValue('jefe-2') },
    });
    service.audit = jest.fn().mockResolvedValue(undefined);
    service.findOne = jest.fn().mockResolvedValue({ ...solicitudWeb });
  });

  describe('createFromConversation', () => {
    beforeEach(() => {
      service.createRequest = jest
        .fn()
        .mockResolvedValue({ id: 'solicitud-1' });
    });

    it('crea la solicitud enlazada y toma la conversacion', async () => {
      await service.createFromConversation(CONVERSACION, JEFE);

      expect(service.createRequest).toHaveBeenCalledWith(
        { clientId: 'cliente-1', initialEmployeeId: 'empleada-1' },
        'jefe-1',
        CONVERSACION,
      );
      expect(grupoWeb.tomarControl).toHaveBeenCalledWith(
        expect.objectContaining({ id: CONVERSACION }),
        'jefe-1',
      );
      expect(service.findOne).toHaveBeenCalledWith('solicitud-1', JEFE);
    });

    it('un admin la deja con el jefe que ya la organizaba', async () => {
      requests.findOne.mockResolvedValue({ id: 'previa', bossId: 'jefe-3' });
      await service.createFromConversation(CONVERSACION, {
        id: 'admin-1',
        rol: 'admin',
      });
      expect(service.createRequest).toHaveBeenCalledWith(
        expect.anything(),
        'jefe-3',
        CONVERSACION,
      );
    });

    it('un admin sin solicitud previa usa el jefe asignado de la modelo', async () => {
      await service.createFromConversation(CONVERSACION, {
        id: 'admin-1',
        rol: 'admin',
      });
      expect(service.createRequest).toHaveBeenCalledWith(
        expect.anything(),
        'jefe-2',
        CONVERSACION,
      );
    });

    it('responde 409 si otro jefe ya organiza un grupo del cliente', async () => {
      requests.findOne.mockResolvedValue({ id: 'previa', bossId: 'jefe-9' });
      await expect(
        service.createFromConversation(CONVERSACION, JEFE),
      ).rejects.toThrow(ConflictException);
      expect(service.createRequest).not.toHaveBeenCalled();
      expect(grupoWeb.tomarControl).not.toHaveBeenCalled();
    });

    it('no la crea otro rol', async () => {
      await expect(
        service.createFromConversation(CONVERSACION, {
          id: 'u',
          rol: 'empleada',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('lee los mensajes de la conversacion web', async () => {
    await expect(service.requestMessages('solicitud-1', JEFE)).resolves.toEqual(
      [{ id: 'm1' }],
    );
  });

  it('el mensaje del jefe va al chat web y no a Telegram', async () => {
    const enviado = await service.sendRequestMessage(
      'solicitud-1',
      'Hola',
      JEFE,
    );
    expect(grupoWeb.escribirDelJefe).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSACION }),
      'Hola',
    );
    expect(realtime.emitToBoss).toHaveBeenCalledWith('jefe-1', {
      type: 'group_chat_message',
      data: enviado,
    });
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('pide la ubicacion por el chat web', async () => {
    await expect(
      service.requestClientLocation('solicitud-1', JEFE),
    ).resolves.toEqual({ sent: true });
    expect(grupoWeb.pedirUbicacion).toHaveBeenCalled();
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('no abre catalogo con botones para una solicitud web', async () => {
    await expect(service.openCatalog('solicitud-1', JEFE)).rejects.toThrow(
      /el jefe elige a las modelos/,
    );
    expect(requests.save).not.toHaveBeenCalled();
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  describe('useChatLocation', () => {
    it('aplica el ultimo pin del cliente', async () => {
      grupoWeb.ultimaUbicacionDelCliente.mockResolvedValue({
        lat: 20.59,
        lng: -100.39,
        address: 'Centro',
      });
      await service.useChatLocation('solicitud-1', JEFE);
      expect(requests.save).toHaveBeenCalledWith(
        expect.objectContaining({
          locationLat: 20.59,
          locationLng: -100.39,
          locationReference: 'Centro',
        }),
      );
    });

    it('responde 409 si el cliente no ha mandado pin', async () => {
      await expect(
        service.useChatLocation('solicitud-1', JEFE),
      ).rejects.toThrow(/todavía no compartió su ubicación/);
    });

    it('responde 409 para una solicitud que no viene del chat web', async () => {
      requests.findOneBy.mockResolvedValue({
        ...solicitudWeb,
        conversationId: null,
      });
      await expect(
        service.useChatLocation('solicitud-1', JEFE),
      ).rejects.toThrow(/no viene del chat web/);
    });
  });

  it('el saldo pendiente sale tambien por el chat web', async () => {
    requests.findOne.mockResolvedValue({ conversationId: CONVERSACION });
    const servicio = {
      id: 'servicio-1',
      metodoPago: 'transferencia',
      pendingBalance: 500,
      cliente: { telegramChatId: null },
    };
    await service.notifyPendingTransfer(servicio, { pagoRegistrado: true });
    expect(grupoWeb.avisarSaldo).toHaveBeenCalledWith(
      { conversationId: CONVERSACION },
      servicio,
      { pagoRegistrado: true },
    );
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('al iniciar avisa a cada participante por push, sin Telegram', async () => {
    await service.avisarInicioALaParticipante('servicio-1', {
      employeeId: 'empleada-1',
      role: 'responsable',
      employee: { usuarioId: 'usuario-1', usuario: { telegramChatId: '99' } },
    });
    expect(notifications.notificar).toHaveBeenCalledWith(
      'usuario-1',
      expect.objectContaining({
        url: '/empleada/servicio',
        dedupeKey: 'group_service_started:servicio-1:empleada-1',
      }),
    );
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('un push que falla no rompe el inicio', async () => {
    notifications.notificar.mockRejectedValue(new Error('sin vapid'));
    await expect(
      service.avisarInicioALaParticipante('servicio-1', {
        employeeId: 'empleada-1',
        role: 'participante',
        employee: { usuarioId: 'usuario-1' },
      }),
    ).resolves.toBeUndefined();
  });
});
