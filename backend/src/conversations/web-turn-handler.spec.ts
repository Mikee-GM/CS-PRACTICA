import { ConflictoDeVersionError } from '../booking/booking.errors';
import { estadoInicial, type BookingState } from '../booking/booking-state';
import type {
  BookingStateStore,
  ChatChannel,
  ConversationRef,
  InboundMessage,
} from '../booking/chat-channel';
import { ConversationTurnHandler } from './conversation-turn-handler';
import { Conversation } from './entities/conversation.entity';
import { Message, MessageAttachment } from './entities/message.entity';
import { WebChatChannel } from './web-chat-channel';
import { WebTurnHandler } from './web-turn-handler';

const CONVERSACION = 'conversacion-1';

type MensajeFalso = {
  id: string;
  sender: 'cliente' | 'ia';
  body: string;
  attachment: MessageAttachment | null;
  created_at: Date;
};

/**
 * Una base en memoria con lo justo para el turno: advisory locks por sesion,
 * la conversacion, sus mensajes y el estado con version. Sirve para probar la
 * serializacion de turnos sin Postgres.
 */
class BaseFalsa {
  readonly locks = new Set<string>();
  readonly mensajes: MensajeFalso[] = [];
  conversacion = {
    id: CONVERSACION,
    clientId: 'cliente-1',
    employeeId: 'empleada-1',
    bookingSessionId: null as string | null,
    status: 'activa',
    mode: 'AI_ACTIVE',
  };
  estado: BookingState | null = null;
  version = 0;
  private reloj = Date.parse('2026-11-16T20:00:00Z');

  agregar(
    id: string,
    body: string,
    attachment: MessageAttachment | null = null,
  ): Message {
    this.reloj += 1000;
    this.mensajes.push({
      id,
      sender: 'cliente',
      body,
      attachment,
      created_at: new Date(this.reloj),
    });
    return { id } as Message;
  }

  readonly dataSource = {
    createQueryRunner: () => ({
      connect: () => Promise.resolve(),
      release: () => Promise.resolve(),
      query: (sql: string, params: unknown[]) => {
        const clave = `${String(params[0])}:${String(params[1])}`;
        if (sql.includes('pg_try_advisory_lock')) {
          if (this.locks.has(clave))
            return Promise.resolve([{ locked: false }]);
          this.locks.add(clave);
          return Promise.resolve([{ locked: true }]);
        }
        this.locks.delete(clave);
        return Promise.resolve([{ pg_advisory_unlock: true }]);
      },
    }),
    query: (sql: string, params: unknown[]) => {
      if (sql.includes("state->>'ultimoMensajeAtendidoId'")) {
        return Promise.resolve([
          {
            status: this.conversacion.status,
            cursor: this.estado?.ultimoMensajeAtendidoId ?? null,
          },
        ]);
      }
      if (sql.includes("m.sender = 'cliente'")) {
        const [, cursor, limite] = params as [string, string | null, number];
        const delCliente = this.mensajes.filter((m) => m.sender === 'cliente');
        const desde = cursor
          ? delCliente.findIndex((m) => m.id === cursor) + 1
          : 0;
        return Promise.resolve(
          delCliente.slice(desde).reverse().slice(0, limite),
        );
      }
      return Promise.reject(new Error(`Consulta no prevista: ${sql}`));
    },
  };

  readonly store: BookingStateStore<BookingState> = {
    load: () =>
      Promise.resolve(
        this.estado
          ? {
              state: JSON.parse(JSON.stringify(this.estado)) as BookingState,
              version: this.version,
            }
          : null,
      ),
    save: (_ref, state, expected) => {
      if (expected !== this.version) {
        return Promise.reject(
          new ConflictoDeVersionError(expected, this.version),
        );
      }
      this.estado = JSON.parse(JSON.stringify(state)) as BookingState;
      this.version += 1;
      return Promise.resolve({ version: this.version });
    },
  };
}

/** Espera a que se cumpla una condicion que depende de promesas en vuelo. */
async function hasta(condicion: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condicion(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  if (!condicion()) throw new Error('La condicion no se cumplio a tiempo');
}

describe('WebTurnHandler', () => {
  let base: BaseFalsa;
  let bookingService: { handleClientMessage: jest.Mock };
  let atendidos: InboundMessage[];
  let canales: ChatChannel[];
  let handler: WebTurnHandler;
  // Se invoca por la interfaz, como lo hace `ConversationsService`.
  let turno: ConversationTurnHandler;

  /** Lo que hace `BookingService` con el cursor, sin la conversacion. */
  async function atender(
    ref: ConversationRef,
    inbound: InboundMessage,
    canal: ChatChannel,
    store: BookingStateStore<BookingState>,
  ): Promise<void> {
    atendidos.push(inbound);
    canales.push(canal);
    const cargado = await store.load(ref);
    const estado = cargado?.state ?? estadoInicial();
    estado.ultimoMensajeAtendidoId = inbound.channelMessageId;
    await store.save(ref, estado, cargado?.version ?? 0);
  }

  beforeEach(() => {
    base = new BaseFalsa();
    atendidos = [];
    canales = [];
    bookingService = { handleClientMessage: jest.fn(atender) };
    const conversationsRepository = {
      findOne: jest.fn(() => Promise.resolve({ ...base.conversacion })),
    };
    const config = { get: jest.fn().mockReturnValue(0) };
    handler = new WebTurnHandler(
      base.dataSource as any,
      conversationsRepository as any,
      { findOne: jest.fn() } as any,
      { emitToClient: jest.fn(), emitToBosses: jest.fn() } as any,
      bookingService as any,
      base.store as any,
      config as any,
    );
    handler.intervaloReintentoMs = 2;
    turno = handler;
  });

  const conversacion = () => base.conversacion as unknown as Conversation;

  it('atiende el mensaje con el canal web y avanza el cursor', async () => {
    const mensaje = base.agregar('m1', 'hola');

    await turno.onClientMessage(conversacion(), mensaje);

    expect(atendidos).toHaveLength(1);
    expect(atendidos[0]).toMatchObject({
      text: 'hola',
      channelMessageId: 'm1',
      attachments: [],
    });
    expect(canales[0]).toBeInstanceOf(WebChatChannel);
    const [ref] = bookingService.handleClientMessage.mock.calls[0] as [
      ConversationRef,
    ];
    expect(ref).toEqual({
      clienteId: 'cliente-1',
      empleadaId: 'empleada-1',
      bookingSessionId: null,
      channel: 'web',
      conversationId: CONVERSACION,
    });
    expect(base.estado?.ultimoMensajeAtendidoId).toBe('m1');
    expect(base.locks.size).toBe(0);
  });

  it('serializa dos mensajes seguidos sin perder ni duplicar respuestas', async () => {
    let liberar: () => void = () => undefined;
    const bloqueo = new Promise<void>((resolve) => (liberar = resolve));
    bookingService.handleClientMessage.mockImplementationOnce(
      async (...args: Parameters<typeof atender>) => {
        await bloqueo;
        await atender(...args);
      },
    );

    const primero = turno.onClientMessage(
      conversacion(),
      base.agregar('m1', 'hola'),
    );
    await hasta(
      () => bookingService.handleClientMessage.mock.calls.length === 1,
    );

    // Llega otro mensaje con el primer turno todavia en curso.
    const segundo = turno.onClientMessage(
      conversacion(),
      base.agregar('m2', 'quiero 2 horas'),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bookingService.handleClientMessage).toHaveBeenCalledTimes(1);

    liberar();
    await Promise.all([primero, segundo]);

    expect(atendidos.map((m) => m.channelMessageId)).toEqual(['m1', 'm2']);
    expect(atendidos.map((m) => m.text)).toEqual(['hola', 'quiero 2 horas']);
    expect(base.estado?.ultimoMensajeAtendidoId).toBe('m2');
    expect(base.locks.size).toBe(0);
  });

  it('agrupa en un solo turno los mensajes que ya esperaban', async () => {
    const m1 = base.agregar('m1', 'hola');
    const m2 = base.agregar('m2', 'quiero 2 horas');

    await Promise.all([
      turno.onClientMessage(conversacion(), m1),
      turno.onClientMessage(conversacion(), m2),
    ]);

    expect(atendidos).toHaveLength(1);
    expect(atendidos[0]).toMatchObject({
      text: 'hola\nquiero 2 horas',
      channelMessageId: 'm2',
    });
  });

  it('pasa el pin del cliente como adjunto de ubicacion', async () => {
    const mensaje = base.agregar('m1', '', {
      type: 'ubicacion',
      lat: 20.6,
      lng: -100.4,
      address: 'Centro',
    });

    await turno.onClientMessage(conversacion(), mensaje);

    expect(atendidos[0]).toMatchObject({
      text: '',
      attachments: [
        { type: 'location', lat: 20.6, lng: -100.4, address: 'Centro' },
      ],
    });
  });

  it('con la conversacion en manos de una persona la IA no responde', async () => {
    base.conversacion.mode = 'HUMAN_ACTIVE';

    await turno.onClientMessage(conversacion(), base.agregar('m1', 'hola'));

    expect(bookingService.handleClientMessage).not.toHaveBeenCalled();
    // Lo atendio la persona: al devolver el control la IA no lo contesta.
    expect(base.estado?.ultimoMensajeAtendidoId).toBe('m1');
  });

  it('una conversacion cerrada no tiene turno', async () => {
    base.conversacion.status = 'cerrada';

    await turno.onClientMessage(conversacion(), base.agregar('m1', 'hola'));

    expect(bookingService.handleClientMessage).not.toHaveBeenCalled();
    expect(base.estado).toBeNull();
  });

  it('si el turno falla suelta el lock y no reintenta en bucle', async () => {
    bookingService.handleClientMessage.mockRejectedValue(
      new Error('base caida'),
    );

    await turno.onClientMessage(conversacion(), base.agregar('m1', 'hola'));

    expect(bookingService.handleClientMessage).toHaveBeenCalledTimes(1);
    expect(base.locks.size).toBe(0);
  });
});
