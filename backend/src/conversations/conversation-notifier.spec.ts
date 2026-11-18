import { MESSAGE_CREATED } from './conversation-events';
import { ConversationNotifier } from './conversation-notifier';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

const CLIENTE = 'cliente-1';
const MODELO = 'empleada-1';
const SERVICIO = 'servicio-1';
const CONVERSACION = '11111111-1111-4111-8111-111111111111';

/**
 * Los avisos del ciclo de vida del servicio llegan al chat web del cliente.
 *
 * Antes solo salian por Telegram: quien reservo desde la web no se enteraba
 * de que su servicio se acepto, se rechazo o iba en camino.
 */
describe('ConversationNotifier', () => {
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let empleadasRepository: { findOne: jest.Mock };
  let realtime: { emitToClient: jest.Mock; emitToBosses: jest.Mock };
  let notifier: ConversationNotifier;

  const creadoEn = new Date('2026-11-16T12:00:00Z');

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue({
        id: CONVERSACION,
        clientId: CLIENTE,
        employeeId: MODELO,
        status: 'con_servicio',
        lastMessageAt: null,
      }),
      create: jest.fn((_entidad: unknown, datos: Partial<Message>) => datos),
      save: jest.fn((datos: Partial<Message>) =>
        Promise.resolve({ ...datos, id: 'mensaje-1', createdAt: creadoEn }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((trabajo: (m: typeof manager) => unknown) =>
        trabajo(manager),
      ),
    };
    empleadasRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: MODELO,
        jefeId: 'jefe-1',
        jefeSecundarioId: 'jefe-2',
      }),
    };
    realtime = { emitToClient: jest.fn(), emitToBosses: jest.fn() };
    notifier = new ConversationNotifier(
      dataSource as any,
      empleadasRepository as any,
      realtime as any,
    );
  });

  it('entrega en la conversacion del servicio sin buscar la de la modelo', async () => {
    dataSource.query.mockResolvedValueOnce([{ id: CONVERSACION }]);

    const entregado = await notifier.notifyClient({
      clienteId: CLIENTE,
      serviceId: SERVICIO,
      employeeId: MODELO,
      texto: 'Ya voy en camino',
    });

    expect(entregado).toBe(true);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const [sql, parametros] = dataSource.query.mock.calls[0];
    expect(sql).toContain('c.service_id = $2');
    expect(sql).toContain('booking_session_id');
    expect(parametros).toEqual([CLIENTE, SERVICIO]);
    expect(manager.findOne).toHaveBeenCalledWith(
      Conversation,
      expect.objectContaining({
        where: { id: CONVERSACION, clientId: CLIENTE },
        lock: { mode: 'pessimistic_write' },
      }),
    );
  });

  it('guarda el aviso como mensaje del sistema y mueve last_message_at', async () => {
    dataSource.query.mockResolvedValueOnce([{ id: CONVERSACION }]);

    await notifier.notifyClient({
      clienteId: CLIENTE,
      serviceId: SERVICIO,
      texto: '  Servicio aceptado  ',
    });

    expect(manager.create).toHaveBeenCalledWith(Message, {
      conversationId: CONVERSACION,
      sender: 'sistema',
      body: 'Servicio aceptado',
    });
    expect(manager.update).toHaveBeenCalledWith(
      Conversation,
      { id: CONVERSACION },
      { lastMessageAt: creadoEn },
    );
  });

  it('sin conversacion del servicio cae a la abierta mas reciente con la modelo', async () => {
    dataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: CONVERSACION }]);

    const entregado = await notifier.notifyClient({
      clienteId: CLIENTE,
      serviceId: SERVICIO,
      employeeId: MODELO,
      texto: 'Tu cita cambio de hora',
    });

    expect(entregado).toBe(true);
    const [sql, parametros] = dataSource.query.mock.calls[1];
    expect(sql).toContain("c.status <> 'cerrada'");
    expect(sql).toContain('ORDER BY c.last_message_at DESC');
    expect(parametros).toEqual([CLIENTE, MODELO]);
  });

  it('sin ninguna conversacion no escribe nada y devuelve false', async () => {
    const entregado = await notifier.notifyClient({
      clienteId: CLIENTE,
      serviceId: SERVICIO,
      employeeId: MODELO,
      texto: 'Servicio aceptado',
    });

    expect(entregado).toBe(false);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(realtime.emitToClient).not.toHaveBeenCalled();
  });

  it('sin servicio ni modelo no consulta nada', async () => {
    const entregado = await notifier.notifyClient({
      clienteId: CLIENTE,
      texto: 'Hola',
    });

    expect(entregado).toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('un texto vacio no deja un mensaje en blanco', async () => {
    const entregado = await notifier.notifyClient({
      clienteId: CLIENTE,
      serviceId: SERVICIO,
      texto: '   ',
    });

    expect(entregado).toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('no lanza si la base falla: el servicio ya cambio y no se deshace', async () => {
    dataSource.query.mockRejectedValueOnce(new Error('conexion perdida'));

    await expect(
      notifier.notifyClient({
        clienteId: CLIENTE,
        serviceId: SERVICIO,
        texto: 'Servicio aceptado',
      }),
    ).resolves.toBe(false);
    expect(realtime.emitToClient).not.toHaveBeenCalled();
  });

  it('no lanza si falla la escritura del mensaje', async () => {
    dataSource.query.mockResolvedValueOnce([{ id: CONVERSACION }]);
    manager.save.mockRejectedValueOnce(new Error('violacion'));

    await expect(
      notifier.notifyClient({
        clienteId: CLIENTE,
        serviceId: SERVICIO,
        texto: 'Servicio aceptado',
      }),
    ).resolves.toBe(false);
  });

  it('emite message_created al cliente y a los jefes de la modelo', async () => {
    dataSource.query.mockResolvedValueOnce([{ id: CONVERSACION }]);

    await notifier.notifyClient({
      clienteId: CLIENTE,
      serviceId: SERVICIO,
      texto: 'Servicio aceptado',
    });

    const evento = {
      type: MESSAGE_CREATED,
      data: { conversationId: CONVERSACION, messageId: 'mensaje-1' },
    };
    expect(realtime.emitToClient).toHaveBeenCalledWith(CLIENTE, evento);
    expect(realtime.emitToBosses).toHaveBeenCalledWith(
      ['jefe-1', 'jefe-2'],
      evento,
    );
  });

  it('un fallo del evento no convierte en error un aviso ya guardado', async () => {
    dataSource.query.mockResolvedValueOnce([{ id: CONVERSACION }]);
    realtime.emitToClient.mockImplementationOnce(() => {
      throw new Error('bus caido');
    });

    await expect(
      notifier.notifyClient({
        clienteId: CLIENTE,
        serviceId: SERVICIO,
        texto: 'Servicio aceptado',
      }),
    ).resolves.toBe(true);
  });

  /** Escritura dirigida, para quien actua a peticion de una persona. */
  describe('escribir', () => {
    it('guarda en esa conversacion con el remitente pedido y lo anuncia', async () => {
      const message = await notifier.escribir({
        conversationId: CONVERSACION,
        sender: 'jefe',
        texto: '  Ya tenemos a las chicas  ',
      });

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(
        Conversation,
        expect.objectContaining({
          where: { id: CONVERSACION },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(manager.create).toHaveBeenCalledWith(Message, {
        conversationId: CONVERSACION,
        sender: 'jefe',
        body: 'Ya tenemos a las chicas',
      });
      expect(message.id).toBe('mensaje-1');
      expect(realtime.emitToClient).toHaveBeenCalledWith(CLIENTE, {
        type: MESSAGE_CREATED,
        data: { conversationId: CONVERSACION, messageId: 'mensaje-1' },
      });
    });

    it('responde 404 si la conversacion no existe', async () => {
      manager.findOne.mockResolvedValueOnce(null);
      await expect(
        notifier.escribir({
          conversationId: CONVERSACION,
          sender: 'sistema',
          texto: 'Hola',
        }),
      ).rejects.toThrow('Conversación no encontrada');
    });

    it('un mensaje del jefe no entra en una conversacion cerrada', async () => {
      manager.findOne.mockResolvedValueOnce({
        id: CONVERSACION,
        clientId: CLIENTE,
        employeeId: MODELO,
        status: 'cerrada',
      });
      await expect(
        notifier.escribir({
          conversationId: CONVERSACION,
          sender: 'jefe',
          texto: 'Hola',
        }),
      ).rejects.toThrow(/cerrada/);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('un aviso del sistema si queda en el historial de una cerrada', async () => {
      manager.findOne.mockResolvedValueOnce({
        id: CONVERSACION,
        clientId: CLIENTE,
        employeeId: MODELO,
        status: 'cerrada',
      });
      await expect(
        notifier.escribir({
          conversationId: CONVERSACION,
          sender: 'sistema',
          texto: 'Pago recibido',
        }),
      ).resolves.toEqual(expect.objectContaining({ id: 'mensaje-1' }));
    });

    it('rechaza un texto vacio sin tocar la base', async () => {
      await expect(
        notifier.escribir({
          conversationId: CONVERSACION,
          sender: 'jefe',
          texto: '   ',
        }),
      ).rejects.toThrow('El mensaje no puede estar vacío');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
