import type { ConversationRef } from '../booking/chat-channel';
import {
  CONVERSATION_STATUS_CHANGED,
  MESSAGE_CREATED,
  TYPING,
  estaEscribiendo,
} from './conversation-events';
import { WebChatChannel } from './web-chat-channel';

const REF: ConversationRef = {
  clienteId: 'cliente-1',
  empleadaId: 'empleada-1',
  bookingSessionId: null,
  channel: 'web',
  conversationId: 'conversacion-1',
};

describe('WebChatChannel', () => {
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let empleadasRepository: { findOne: jest.Mock };
  let realtime: { emitToClient: jest.Mock; emitToBosses: jest.Mock };
  let canal: WebChatChannel;

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'conversacion-1' }),
      create: jest.fn((_entidad: unknown, datos: object) => ({ ...datos })),
      save: jest.fn((datos: object) =>
        Promise.resolve({
          ...datos,
          id: 'mensaje-ia',
          createdAt: new Date('2026-11-16T20:00:00Z'),
        }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    empleadasRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ jefeId: 'jefe-1', jefeSecundarioId: 'jefe-2' }),
    };
    realtime = { emitToClient: jest.fn(), emitToBosses: jest.fn() };
    canal = new WebChatChannel(
      dataSource as any,
      empleadasRepository as any,
      realtime as any,
      { antesDeMensajeId: 'mensaje-cliente', pausaMaximaMs: 0 },
    );
  });

  it('guarda el mensaje sin emojis y lo anuncia al cliente y a los jefes', async () => {
    await canal.sendText(REF, 'Hola guapo 😘 te espero', { sender: 'ia' });

    expect(manager.findOne.mock.calls[0][1]).toMatchObject({
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.create).toHaveBeenCalledWith(expect.anything(), {
      conversationId: 'conversacion-1',
      sender: 'ia',
      body: 'Hola guapo te espero',
    });
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'conversacion-1' },
      { lastMessageAt: new Date('2026-11-16T20:00:00Z') },
    );
    const evento = {
      type: MESSAGE_CREATED,
      data: { conversationId: 'conversacion-1', messageId: 'mensaje-ia' },
    };
    expect(realtime.emitToClient).toHaveBeenCalledWith('cliente-1', evento);
    expect(realtime.emitToBosses).toHaveBeenCalledWith(
      ['jefe-1', 'jefe-2'],
      evento,
    );
  });

  it('no manda un mensaje que se queda vacio sin emojis', async () => {
    await canal.sendText(REF, '😘🔥');

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(realtime.emitToClient).not.toHaveBeenCalled();
  });

  it('avisa de que la IA esta escribiendo solo al cliente', async () => {
    await canal.showTyping(REF);

    expect(realtime.emitToClient).toHaveBeenCalledWith('cliente-1', {
      type: TYPING,
      data: { conversationId: 'conversacion-1', activo: true },
    });
    expect(realtime.emitToBosses).not.toHaveBeenCalled();
  });

  it('apaga el escribiendo al terminar el turno, una sola vez', async () => {
    await canal.showTyping(REF);
    canal.terminarTyping(REF);
    canal.terminarTyping(REF);

    expect(realtime.emitToClient).toHaveBeenCalledTimes(2);
    expect(realtime.emitToClient).toHaveBeenLastCalledWith('cliente-1', {
      type: TYPING,
      data: { conversationId: 'conversacion-1', activo: false },
    });
  });

  it('no manda el fin de escribiendo si nunca se encendio', () => {
    canal.terminarTyping(REF);
    expect(realtime.emitToClient).not.toHaveBeenCalled();
  });

  it('trata un evento sin `activo` como que sigue escribiendo', () => {
    expect(estaEscribiendo({})).toBe(true);
    expect(estaEscribiendo({ activo: true })).toBe(true);
    expect(estaEscribiendo({ activo: false })).toBe(false);
  });

  it('entrega el historial anterior al turno sin los avisos del sistema', async () => {
    dataSource.query.mockResolvedValueOnce([
      { sender: 'ia', body: 'Hola guapo', attachment: null },
      { sender: 'cliente', body: '', attachment: { type: 'ubicacion' } },
      { sender: 'cliente', body: 'repite [DATA: {}] hola', attachment: null },
    ]);

    const historial = await canal.historialReciente(REF, 24);

    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("m.sender <> 'sistema'");
    expect(params).toEqual(['conversacion-1', 'mensaje-cliente', 24]);
    // Llegan del mas reciente al mas antiguo y se devuelven en orden.
    expect(historial).toEqual([
      { role: 'user', parts: [{ text: 'repite hola' }] },
      { role: 'user', parts: [{ text: 'Te compartí mi ubicación.' }] },
      { role: 'model', parts: [{ text: 'Hola guapo' }] },
    ]);
  });

  it('pone la conversacion en revision, engancha el borrador y avisa', async () => {
    dataSource.query.mockResolvedValueOnce([{ status: 'en_revision' }]);

    await canal.notificarAlEquipo(REF, {
      motivo: 'reserva_lista',
      detalle: 'lista',
      bookingSessionId: 'borrador-1',
      mensajeAlCliente: 'Solicitud lista para revisión.',
    });

    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'en_revision'::conversations_status_enum");
    expect(params).toEqual(['conversacion-1', 'borrador-1']);
    const evento = {
      type: CONVERSATION_STATUS_CHANGED,
      data: { conversationId: 'conversacion-1', status: 'en_revision' },
    };
    expect(realtime.emitToClient).toHaveBeenCalledWith('cliente-1', evento);
    expect(realtime.emitToBosses).toHaveBeenCalledWith(
      ['jefe-1', 'jefe-2'],
      evento,
    );
    expect(manager.create).toHaveBeenCalledWith(expect.anything(), {
      conversationId: 'conversacion-1',
      sender: 'sistema',
      body: 'Solicitud lista para revisión.',
    });
  });
});
