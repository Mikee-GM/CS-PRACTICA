import { ConflictException, NotFoundException } from '@nestjs/common';
import { MESSAGE_CREATED } from './conversation-events';
import { ConversationTurnHandler } from './conversation-turn-handler';
import { ConversationsService } from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

const USUARIO = 'usuario-1';
const CLIENTE = 'cliente-1';
const MODELO = 'empleada-1';
const CONVERSACION = '11111111-1111-4111-8111-111111111111';
const CLIENT_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

function filaResumen(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSACION,
    status: 'activa',
    last_message_at: null,
    created_at: new Date('2026-11-16T10:00:00Z'),
    employee_id: MODELO,
    nombre_artistico: 'Valentina',
    slug_catalogo: 'valentina',
    foto_perfil_url: 'https://cdn/valentina.jpg',
    last_id: null,
    last_sender: null,
    last_body: null,
    last_has_attachment: null,
    last_created_at: null,
    ...overrides,
  };
}

function conversacion(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSACION,
    clientId: CLIENTE,
    employeeId: MODELO,
    status: 'activa',
    mode: 'AI_ACTIVE',
    lastMessageAt: null,
    ...overrides,
  } as Conversation;
}

function mensaje(overrides: Partial<Message> = {}): Message {
  return {
    id: 'mensaje-1',
    conversationId: CONVERSACION,
    sender: 'cliente',
    body: 'Hola',
    attachment: null,
    receiptValidationId: null,
    clientMessageId: CLIENT_MESSAGE_ID,
    createdAt: new Date('2026-11-16T10:05:00Z'),
    ...overrides,
  } as Message;
}

describe('ConversationsService', () => {
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let conversationsRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let clientesRepository: { findOne: jest.Mock };
  let empleadasRepository: { findOne: jest.Mock };
  let realtime: { emitToClient: jest.Mock; emitToBosses: jest.Mock };
  let turnHandler: { onClientMessage: jest.Mock };

  function crearServicio(
    handler?: ConversationTurnHandler,
  ): ConversationsService {
    return new ConversationsService(
      dataSource as any,
      conversationsRepository as any,
      clientesRepository as any,
      empleadasRepository as any,
      realtime as any,
      handler,
    );
  }

  beforeEach(() => {
    manager = {
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    conversationsRepository = {
      findOne: jest.fn(),
      create: jest.fn((data: object) => ({ ...data })),
      save: jest.fn(),
    };
    clientesRepository = {
      findOne: jest.fn().mockResolvedValue({ id: CLIENTE }),
    };
    empleadasRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: MODELO,
        jefeId: 'jefe-1',
        jefeSecundarioId: 'jefe-2',
      }),
    };
    realtime = { emitToClient: jest.fn(), emitToBosses: jest.fn() };
    turnHandler = { onClientMessage: jest.fn().mockResolvedValue(undefined) };
  });

  describe('ficha del cliente', () => {
    it('responde 404 si la cuenta no tiene ficha de cliente', async () => {
      clientesRepository.findOne.mockResolvedValue(null);

      await expect(crearServicio().listForClient(USUARIO)).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('lista solo las conversaciones de la ficha de la sesion', async () => {
      dataSource.query.mockResolvedValue([
        filaResumen({
          last_message_at: new Date('2026-11-16T10:05:00Z'),
          last_id: 'mensaje-1',
          last_sender: 'cliente',
          last_body: 'x'.repeat(141),
          last_has_attachment: false,
          last_created_at: new Date('2026-11-16T10:05:00Z'),
        }),
      ]);

      const lista = await crearServicio().listForClient(USUARIO);

      expect(clientesRepository.findOne).toHaveBeenCalledWith({
        where: { usuarioId: USUARIO },
        select: { id: true },
      });
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('WHERE c.client_id = $1');
      expect(sql).toContain('ORDER BY c.last_message_at DESC NULLS LAST');
      expect(params).toEqual([CLIENTE, null, 100]);
      expect(lista[0].employee).toEqual({
        id: MODELO,
        nombreArtistico: 'Valentina',
        slugCatalogo: 'valentina',
        fotoPerfilUrl: 'https://cdn/valentina.jpg',
      });
      expect(lista[0].lastMessage?.preview).toBe(`${'x'.repeat(140)}...`);
    });

    it('no expone el nombre real ni el contacto de la modelo', async () => {
      dataSource.query.mockResolvedValue([filaResumen()]);

      await crearServicio().listForClient(USUARIO);

      const [sql] = dataSource.query.mock.calls[0] as [string];
      expect(sql).not.toMatch(/nombre_real|telefono|email|telegram/);
    });
  });

  describe('openWithEmployee', () => {
    it('rechaza una modelo que no es visible en el catalogo', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      await expect(
        crearServicio().openWithEmployee(USUARIO, MODELO),
      ).rejects.toThrow(NotFoundException);

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('e.catalogo_activo = true');
      expect(sql).toContain('u.activo = true');
      expect(sql).toContain('disciplinary_sanctions');
      expect(params).toEqual([MODELO]);
      expect(conversationsRepository.save).not.toHaveBeenCalled();
    });

    it('devuelve la conversacion abierta sin crear otra', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: MODELO }])
        .mockResolvedValueOnce([filaResumen()]);
      conversationsRepository.findOne.mockResolvedValue(conversacion());

      const resultado = await crearServicio().openWithEmployee(USUARIO, MODELO);

      expect(resultado.creada).toBe(false);
      expect(resultado.conversation.id).toBe(CONVERSACION);
      expect(conversationsRepository.save).not.toHaveBeenCalled();
    });

    it('crea la conversacion con la IA activa', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: MODELO }])
        .mockResolvedValueOnce([filaResumen()]);
      conversationsRepository.findOne.mockResolvedValue(null);
      conversationsRepository.save.mockResolvedValue({ id: CONVERSACION });

      const resultado = await crearServicio().openWithEmployee(USUARIO, MODELO);

      expect(conversationsRepository.create).toHaveBeenCalledWith({
        clientId: CLIENTE,
        employeeId: MODELO,
        status: 'activa',
        mode: 'AI_ACTIVE',
      });
      expect(resultado.creada).toBe(true);
    });

    it('si pierde la carrera del indice unico devuelve la ganadora', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: MODELO }])
        .mockResolvedValueOnce([filaResumen({ id: 'ganadora' })]);
      conversationsRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(conversacion({ id: 'ganadora' }));
      conversationsRepository.save.mockRejectedValue({
        code: '23505',
        constraint: 'uq_conversations_client_employee_open',
      });

      const resultado = await crearServicio().openWithEmployee(USUARIO, MODELO);

      expect(resultado.creada).toBe(false);
      expect(resultado.conversation.id).toBe('ganadora');
      const [, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
      expect(params).toEqual([CLIENTE, 'ganadora', 100]);
    });

    it('no oculta otras violaciones de unicidad', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: MODELO }]);
      conversationsRepository.findOne.mockResolvedValue(null);
      const error = { code: '23505', constraint: 'otra' };
      conversationsRepository.save.mockRejectedValue(error);

      await expect(
        crearServicio().openWithEmployee(USUARIO, MODELO),
      ).rejects.toBe(error);
    });
  });

  describe('listMessages', () => {
    const filaMensaje = (id: string) => ({
      id,
      conversation_id: CONVERSACION,
      sender: 'cliente',
      body: `cuerpo ${id}`,
      attachment: null,
      client_message_id: null,
      created_at: new Date('2026-11-16T10:00:00Z'),
    });

    it('responde 404 si la conversacion es de otro cliente', async () => {
      conversationsRepository.findOne.mockResolvedValue(null);

      await expect(
        crearServicio().listMessages(USUARIO, CONVERSACION, {}),
      ).rejects.toThrow(NotFoundException);
      expect(conversationsRepository.findOne).toHaveBeenCalledWith({
        where: { id: CONVERSACION, clientId: CLIENTE },
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('pagina por cursor (created_at, id) y entrega el siguiente cursor', async () => {
      conversationsRepository.findOne.mockResolvedValue(conversacion());
      dataSource.query.mockResolvedValue([
        filaMensaje('m3'),
        filaMensaje('m2'),
        filaMensaje('m1'),
      ]);

      const pagina = await crearServicio().listMessages(USUARIO, CONVERSACION, {
        cursor: 'cursor-1',
        limit: 2,
      });

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('(m.created_at, m.id) < (');
      expect(sql).toContain('ORDER BY m.created_at DESC, m.id DESC');
      // Uno de mas para saber si hay otra pagina.
      expect(params).toEqual([CONVERSACION, 'cursor-1', 3]);
      expect(pagina.items.map((m) => m.id)).toEqual(['m3', 'm2']);
      expect(pagina.nextCursor).toBe('m2');
    });

    it('sin mas mensajes no hay cursor y la primera pagina no lo usa', async () => {
      conversationsRepository.findOne.mockResolvedValue(conversacion());
      dataSource.query.mockResolvedValue([filaMensaje('m1')]);

      const pagina = await crearServicio().listMessages(
        USUARIO,
        CONVERSACION,
        {},
      );

      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([CONVERSACION, null, 31]);
      expect(pagina.nextCursor).toBeNull();
    });

    it('solo entrega el tipo del adjunto, no la clave del archivo', async () => {
      conversationsRepository.findOne.mockResolvedValue(conversacion());
      dataSource.query.mockResolvedValue([
        {
          ...filaMensaje('m1'),
          attachment: { type: 'comprobante', url: 'r2/clave-privada' },
        },
      ]);

      const pagina = await crearServicio().listMessages(
        USUARIO,
        CONVERSACION,
        {},
      );

      expect(pagina.items[0].attachment).toEqual({ type: 'comprobante' });
    });
  });

  describe('sendClientMessage', () => {
    const dto = { body: 'Hola', clientMessageId: CLIENT_MESSAGE_ID };

    it('guarda el mensaje, actualiza last_message_at y avisa', async () => {
      const guardado = mensaje();
      manager.findOne
        .mockResolvedValueOnce(conversacion())
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(guardado);

      const resultado = await crearServicio(turnHandler).sendClientMessage(
        USUARIO,
        CONVERSACION,
        dto,
      );

      expect(manager.findOne).toHaveBeenNthCalledWith(1, Conversation, {
        where: { id: CONVERSACION, clientId: CLIENTE },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.create).toHaveBeenCalledWith(Message, {
        conversationId: CONVERSACION,
        sender: 'cliente',
        body: 'Hola',
        clientMessageId: CLIENT_MESSAGE_ID,
      });
      expect(manager.update).toHaveBeenCalledWith(
        Conversation,
        { id: CONVERSACION },
        { lastMessageAt: guardado.createdAt },
      );
      expect(resultado.creado).toBe(true);
      expect(resultado.message.id).toBe('mensaje-1');

      const evento = {
        type: MESSAGE_CREATED,
        data: { conversationId: CONVERSACION, messageId: 'mensaje-1' },
      };
      expect(realtime.emitToClient).toHaveBeenCalledWith(CLIENTE, evento);
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        ['jefe-1', 'jefe-2'],
        evento,
      );
      await new Promise((r) => setImmediate(r));
      expect(turnHandler.onClientMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: CONVERSACION }),
        guardado,
      );
    });

    it('guarda el pin como adjunto de ubicacion, aunque no haya texto', async () => {
      const guardado = mensaje({
        body: '',
        attachment: { type: 'ubicacion', lat: 20.59, lng: -100.39 },
      });
      manager.findOne
        .mockResolvedValueOnce(conversacion())
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(guardado);

      const resultado = await crearServicio(turnHandler).sendClientMessage(
        USUARIO,
        CONVERSACION,
        {
          clientMessageId: CLIENT_MESSAGE_ID,
          location: { lat: 20.59, lng: -100.39, address: 'Centro' },
        },
      );

      expect(manager.create).toHaveBeenCalledWith(Message, {
        conversationId: CONVERSACION,
        sender: 'cliente',
        body: '',
        attachment: {
          type: 'ubicacion',
          lat: 20.59,
          lng: -100.39,
          address: 'Centro',
        },
        clientMessageId: CLIENT_MESSAGE_ID,
      });
      // Al cliente solo le vuelve el tipo del adjunto.
      expect(resultado.message.attachment).toEqual({ type: 'ubicacion' });
    });

    it('es idempotente por clientMessageId: devuelve el existente sin duplicar ni avisar', async () => {
      const existente = mensaje({ id: 'mensaje-previo' });
      manager.findOne
        .mockResolvedValueOnce(conversacion())
        .mockResolvedValueOnce(existente);

      const resultado = await crearServicio(turnHandler).sendClientMessage(
        USUARIO,
        CONVERSACION,
        dto,
      );

      expect(manager.findOne).toHaveBeenNthCalledWith(2, Message, {
        where: {
          conversationId: CONVERSACION,
          clientMessageId: CLIENT_MESSAGE_ID,
        },
      });
      expect(resultado.creado).toBe(false);
      expect(resultado.message.id).toBe('mensaje-previo');
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(realtime.emitToClient).not.toHaveBeenCalled();
      expect(realtime.emitToBosses).not.toHaveBeenCalled();
      await new Promise((r) => setImmediate(r));
      expect(turnHandler.onClientMessage).not.toHaveBeenCalled();
    });

    it('responde 404 si la conversacion es de otro cliente', async () => {
      manager.findOne.mockResolvedValueOnce(null);

      await expect(
        crearServicio().sendClientMessage(USUARIO, CONVERSACION, dto),
      ).rejects.toThrow(NotFoundException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('responde 409 si la conversacion esta cerrada', async () => {
      manager.findOne
        .mockResolvedValueOnce(conversacion({ status: 'cerrada' }))
        .mockResolvedValueOnce(null);

      await expect(
        crearServicio().sendClientMessage(USUARIO, CONVERSACION, dto),
      ).rejects.toThrow(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(realtime.emitToClient).not.toHaveBeenCalled();
    });

    it('un reintento tras cerrar el chat recibe su mensaje, no un 409', async () => {
      manager.findOne
        .mockResolvedValueOnce(conversacion({ status: 'cerrada' }))
        .mockResolvedValueOnce(mensaje());

      const resultado = await crearServicio().sendClientMessage(
        USUARIO,
        CONVERSACION,
        dto,
      );

      expect(resultado.creado).toBe(false);
    });

    it('sin manejador de turno guarda y avisa igual', async () => {
      manager.findOne
        .mockResolvedValueOnce(conversacion())
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(mensaje());

      const resultado = await crearServicio().sendClientMessage(
        USUARIO,
        CONVERSACION,
        dto,
      );

      expect(resultado.creado).toBe(true);
      expect(realtime.emitToClient).toHaveBeenCalled();
    });

    it('un fallo del manejador de turno no rompe la respuesta', async () => {
      manager.findOne
        .mockResolvedValueOnce(conversacion())
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(mensaje());
      turnHandler.onClientMessage.mockRejectedValue(new Error('IA caida'));
      const servicio = crearServicio(turnHandler);
      const logError = jest
        .spyOn(servicio['logger'], 'error')
        .mockImplementation(() => undefined);

      const resultado = await servicio.sendClientMessage(
        USUARIO,
        CONVERSACION,
        dto,
      );

      expect(resultado.creado).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('IA caida'),
      );
    });

    it('un fallo al avisar a los jefes no rompe la respuesta', async () => {
      manager.findOne
        .mockResolvedValueOnce(conversacion())
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(mensaje());
      empleadasRepository.findOne.mockRejectedValue(new Error('sin base'));
      const servicio = crearServicio();
      jest
        .spyOn(servicio['logger'], 'warn')
        .mockImplementation(() => undefined);

      const resultado = await servicio.sendClientMessage(
        USUARIO,
        CONVERSACION,
        dto,
      );

      expect(resultado.creado).toBe(true);
    });
  });
});
