import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { quitarEmojis } from '../ai/ai-guardrails';
import { palabrasVetadasEn } from '../ai/vocabulario-vetado';
import { ConflictoDeVersionError } from '../booking/booking.errors';
import type { BookingState } from '../booking/booking-state';
import {
  CONVERSATION_MODE_CHANGED,
  CONVERSATION_STATUS_CHANGED,
  MESSAGE_CREATED,
} from './conversation-events';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import {
  jefeDelServicio,
  StaffConversationsService,
  TEXTOS_DEL_EQUIPO,
  textoSeguro,
} from './staff-conversations.service';
import { WebChatChannel } from './web-chat-channel';

const CONVERSACION = '11111111-1111-4111-8111-111111111111';
const CLIENT_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const JEFE = { id: 'jefe-1', rol: 'jefe' } as any;
const OTRO_JEFE = { id: 'jefe-9', rol: 'jefe' } as any;
const ADMIN = { id: 'admin-1', rol: 'admin' } as any;

const atiende = (id: string) => ({
  id,
  activo: true,
  disponible: true,
  enJornada: true,
});

/** Fila de la conversacion compartida por los dobles, como la tabla. */
type FilaConversacion = {
  id: string;
  clientId: string;
  employeeId: string;
  status: string;
  mode: 'AI_ACTIVE' | 'HUMAN_ACTIVE';
  humanOwnerId: string | null;
  humanTakenAt: Date | null;
  bookingSessionId: string | null;
  serviceId: string | null;
  state: Record<string, unknown>;
};

describe('StaffConversationsService', () => {
  let fila: FilaConversacion;
  let estado: {
    state: BookingState | Record<string, unknown>;
    version: number;
  };
  let conflictosDeEstado: number;
  let modelo: Record<string, unknown>;
  let respuestas: Record<string, unknown[]>;
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let mensajeExistente: Message | null;
  let conversationsRepository: { findOne: jest.Mock };
  let empleadasRepository: { findOne: jest.Mock; find: jest.Mock };
  let clientesRepository: { findOne: jest.Mock };
  let borrador: Record<string, unknown>;
  let borradoresRepository: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let serviciosRepository: { findOne: jest.Mock };
  let validacionesRepository: { update: jest.Mock };
  let realtime: {
    emitToClient: jest.Mock;
    emitToBosses: jest.Mock;
    emitToBoss: jest.Mock;
  };
  let store: { load: jest.Mock; save: jest.Mock };
  let servicesService: { reserveNext: jest.Mock; ofrecerAEmpleada: jest.Mock };
  let turnHandler: {
    onClientMessage: jest.Mock;
    procesarPendientes: jest.Mock;
  };
  let avisos: jest.SpyInstance;

  function crear(): StaffConversationsService {
    return new StaffConversationsService(
      dataSource as any,
      conversationsRepository as any,
      empleadasRepository as any,
      clientesRepository as any,
      borradoresRepository as any,
      serviciosRepository as any,
      validacionesRepository as any,
      realtime as any,
      store as any,
      servicesService as any,
      turnHandler as any,
    );
  }

  /** Lo que el UPDATE condicionado decide en Postgres, en una sola vuelta. */
  function tomarOLiberar(
    tomar: boolean,
    params: [string, string, boolean],
  ): unknown[] {
    const [, actorId, forzar] = params;
    const libre =
      fila.status !== 'cerrada' &&
      (fila.mode === 'AI_ACTIVE' ||
        fila.humanOwnerId === null ||
        fila.humanOwnerId === actorId ||
        forzar);
    if (!libre) return [];
    if (tomar) {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = actorId;
      fila.humanTakenAt = new Date('2026-11-17T10:00:00Z');
      return [{ human_taken_at: fila.humanTakenAt }];
    }
    fila.mode = 'AI_ACTIVE';
    fila.humanOwnerId = null;
    fila.humanTakenAt = null;
    return [{ id: fila.id }];
  }

  beforeEach(() => {
    fila = {
      id: CONVERSACION,
      clientId: 'cliente-1',
      employeeId: 'empleada-1',
      status: 'en_revision',
      mode: 'AI_ACTIVE',
      humanOwnerId: null,
      humanTakenAt: null,
      bookingSessionId: 'borrador-1',
      serviceId: null,
      state: {},
    };
    estado = { state: { esquema: 1, lifecycle: 'READY' }, version: 4 };
    conflictosDeEstado = 0;
    modelo = {
      id: 'empleada-1',
      nombreArtistico: 'Valentina',
      precioBaseHora: 2500,
      jefeId: 'jefe-1',
      jefeSecundarioId: 'jefe-2',
      jefe: atiende('jefe-1'),
      jefeSecundario: atiende('jefe-2'),
    };
    respuestas = {};
    mensajeExistente = null;

    dataSource = {
      query: jest.fn((sql: string, params: unknown[]) => {
        if (sql.includes('WITH tomada')) {
          return Promise.resolve(tomarOLiberar(true, params as any));
        }
        if (sql.includes('WITH liberada')) {
          return Promise.resolve(tomarOLiberar(false, params as any));
        }
        if (sql.includes('u.id = c.human_owner_id')) {
          return Promise.resolve([
            {
              status: fila.status,
              human_owner_id: fila.humanOwnerId,
              nombre: 'Jefa Uno',
            },
          ]);
        }
        if (sql.includes("sender <> 'cliente'")) {
          return Promise.resolve(respuestas.ultimaRespuesta ?? []);
        }
        if (sql.includes('SET service_id')) {
          fila.serviceId = params[1] as string;
          fila.status = 'con_servicio';
          return Promise.resolve([]);
        }
        if (sql.includes('v.servicio_id IS NULL')) {
          return Promise.resolve(respuestas.comprobante ?? []);
        }
        if (sql.includes('WITH cancelado')) {
          if (borrador.serviceId || borrador.status === 'ACCEPTING') {
            return Promise.resolve([]);
          }
          borrador.status = 'CANCELLED';
          return Promise.resolve([{ id: borrador.id }]);
        }
        if (sql.includes('WITH suelta')) {
          if (fila.bookingSessionId !== params[1]) return Promise.resolve([]);
          fila.bookingSessionId = null;
          if (fila.status === 'en_revision') fila.status = 'activa';
          return Promise.resolve([{ status: fila.status }]);
        }
        if (sql.includes('cl.nombre_telegram')) {
          return Promise.resolve(respuestas.bandeja ?? []);
        }
        return Promise.reject(new Error(`Consulta no prevista: ${sql}`));
      }),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    manager = {
      findOne: jest.fn((entidad: unknown) => {
        if (entidad === Conversation) return Promise.resolve({ ...fila });
        if (entidad === Message) return Promise.resolve(mensajeExistente);
        return Promise.resolve(null);
      }),
      create: jest.fn((_e: unknown, datos: object) => ({ ...datos })),
      save: jest.fn((datos: object) =>
        Promise.resolve({
          id: 'mensaje-1',
          createdAt: new Date('2026-11-17T10:01:00Z'),
          attachment: null,
          receiptValidationId: null,
          ...datos,
        }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
    conversationsRepository = {
      findOne: jest.fn(() => Promise.resolve({ ...fila })),
    };
    empleadasRepository = {
      findOne: jest.fn(() => Promise.resolve({ ...modelo })),
      find: jest.fn(() => Promise.resolve([{ ...modelo }])),
    };
    clientesRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'cliente-1', telegramChatId: null }),
    };
    borrador = {
      id: 'borrador-1',
      clientId: 'cliente-1',
      intendedEmployeeId: 'empleada-1',
      status: 'READY',
      mode: 'AI_ACTIVE',
      serviceId: null,
      version: 2,
      metadata: {},
      durationHours: 1,
      openEndedDuration: false,
      manualLocationConfirmed: false,
      presetLocationId: null,
      locationName: null,
      locationAddress: null,
      locationNotes: null,
      locationLat: 20.6,
      locationLng: -100.4,
      room: null,
      paymentMethod: 'transferencia',
      scheduleType: 'inmediato',
      scheduledAt: null,
    };
    borradoresRepository = {
      findOne: jest.fn(() => Promise.resolve({ ...borrador })),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
      save: jest.fn((d: object) => Promise.resolve(d)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    serviciosRepository = {
      findOne: jest.fn((opciones: { where: Record<string, unknown> }) =>
        Promise.resolve(
          opciones.where.bookingSessionId
            ? null
            : { id: 'servicio-1', estado: 'pendiente', jefeId: 'jefe-1' },
        ),
      ),
    };
    validacionesRepository = { update: jest.fn().mockResolvedValue(undefined) };
    realtime = {
      emitToClient: jest.fn(),
      emitToBosses: jest.fn(),
      emitToBoss: jest.fn(),
    };
    store = {
      load: jest.fn(() =>
        Promise.resolve({
          state: JSON.parse(JSON.stringify(estado.state)) as BookingState,
          version: estado.version,
        }),
      ),
      save: jest.fn((_ref: unknown, state: BookingState, version: number) => {
        if (conflictosDeEstado > 0) {
          conflictosDeEstado -= 1;
          estado.version += 1;
          return Promise.reject(
            new ConflictoDeVersionError(version, estado.version),
          );
        }
        estado = { state, version: version + 1 };
        return Promise.resolve({ version: estado.version });
      }),
    };
    servicesService = {
      reserveNext: jest.fn().mockResolvedValue({ id: 'servicio-1' }),
      ofrecerAEmpleada: jest.fn().mockResolvedValue(undefined),
    };
    turnHandler = {
      onClientMessage: jest.fn(),
      procesarPendientes: jest.fn().mockResolvedValue(undefined),
    };
    avisos = jest
      .spyOn(WebChatChannel.prototype, 'sendText')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const textosAvisados = () =>
    avisos.mock.calls.map(
      (llamada) => (llamada as [unknown, string, { sender: string }])[1],
    );

  describe('alcance', () => {
    it('un jefe ajeno recibe 404 en todas las operaciones', async () => {
      const servicio = crear();
      const llamadas = [
        () => servicio.listarMensajes(OTRO_JEFE, CONVERSACION, {}),
        () => servicio.tomarControl(OTRO_JEFE, CONVERSACION),
        () => servicio.liberar(OTRO_JEFE, CONVERSACION),
        () =>
          servicio.enviarMensaje(OTRO_JEFE, CONVERSACION, {
            body: 'hola',
            clientMessageId: CLIENT_MESSAGE_ID,
          }),
        () => servicio.aceptar(OTRO_JEFE, CONVERSACION),
        () => servicio.rechazar(OTRO_JEFE, CONVERSACION),
      ];
      for (const llamada of llamadas) {
        await expect(llamada()).rejects.toThrow(NotFoundException);
      }
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('si principal y secundario no pueden atender, cualquier jefe entra', async () => {
      modelo.jefe = { ...atiende('jefe-1'), enJornada: false };
      modelo.jefeSecundario = { ...atiende('jefe-2'), activo: false };

      await expect(
        crear().tomarControl(OTRO_JEFE, CONVERSACION),
      ).resolves.toMatchObject({ humanOwnerId: 'jefe-9' });
    });

    it('una conversacion inexistente responde 404 tambien al admin', async () => {
      conversationsRepository.findOne.mockResolvedValue(null);
      await expect(crear().tomarControl(ADMIN, CONVERSACION)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listar', () => {
    function filaBandeja(overrides: Record<string, unknown> = {}) {
      return {
        id: 'c-1',
        status: 'activa',
        mode: 'AI_ACTIVE',
        human_owner_id: null,
        last_message_at: new Date('2026-11-17T09:00:00Z'),
        created_at: new Date('2026-11-17T08:00:00Z'),
        booking_session_id: null,
        service_id: null,
        state: {},
        employee_id: 'empleada-1',
        nombre_artistico: 'Valentina',
        foto_perfil_url: null,
        client_id: 'cliente-1',
        client_nombre: 'cliente@correo.mx',
        last_id: 'm-1',
        last_sender: 'cliente',
        last_body: 'hola',
        last_has_attachment: false,
        last_created_at: new Date('2026-11-17T09:00:00Z'),
        servicio_espera_comprobante: false,
        comprobante_estado: null,
        comprobante_created_at: null,
        comprobante_confirmado_at: null,
        ...overrides,
      };
    }

    it('el admin ve todas: no filtra por modelo', async () => {
      respuestas.bandeja = [filaBandeja()];

      await crear().listar(ADMIN, {});

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[0]).toBeNull();
      expect(sql).toContain("c.status::text <> 'cerrada'");
      expect(empleadasRepository.find).not.toHaveBeenCalled();
    });

    it('un jefe solo pide las conversaciones de sus modelos', async () => {
      empleadasRepository.find.mockResolvedValue([
        { ...modelo },
        {
          id: 'empleada-ajena',
          jefeId: 'jefe-7',
          jefeSecundarioId: null,
          jefe: atiende('jefe-7'),
          jefeSecundario: null,
        },
      ]);
      respuestas.bandeja = [];

      await crear().listar(JEFE, { estado: 'en_revision', q: 'va%l' });

      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params.slice(0, 3)).toEqual([
        ['empleada-1'],
        'en_revision',
        '%va\\%l%',
      ]);
    });

    it('sin modelos a su alcance no consulta nada', async () => {
      empleadasRepository.find.mockResolvedValue([]);
      await expect(crear().listar(JEFE, {})).resolves.toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('ordena primero lo que pide atencion y explica por que', async () => {
      respuestas.bandeja = [
        filaBandeja({ id: 'tranquila', last_sender: 'ia' }),
        filaBandeja({
          id: 'entregada',
          state: { entregadaAlEquipo: true, fallosIaSeguidos: 3 },
        }),
        filaBandeja({
          id: 'comprobante',
          status: 'en_revision',
          comprobante_estado: 'PENDIENTE_REVISION',
          comprobante_created_at: new Date(),
        }),
      ];

      const bandeja = await crear().listar(ADMIN, {});

      expect(bandeja.map((c) => c.id)).toEqual([
        'entregada',
        'comprobante',
        'tranquila',
      ]);
      expect(bandeja[0].motivosDeAtencion).toEqual([
        'entregada_al_equipo',
        'fallos_ia',
      ]);
      expect(bandeja[1]).toMatchObject({
        comprobanteEnRevision: true,
        motivosDeAtencion: ['en_revision', 'comprobante_en_revision'],
      });
      expect(bandeja[2]).toMatchObject({
        requiereAtencion: false,
        client: { id: 'cliente-1', nombre: 'cliente@correo.mx' },
        employee: {
          id: 'empleada-1',
          nombreArtistico: 'Valentina',
          fotoPerfilUrl: null,
        },
      });
    });

    it('un comprobante con el CEP confirmado ya no esta en revision', async () => {
      respuestas.bandeja = [
        filaBandeja({
          comprobante_estado: 'APROBADO',
          comprobante_created_at: new Date(),
          comprobante_confirmado_at: new Date(),
        }),
      ];
      const [conv] = await crear().listar(ADMIN, {});
      expect(conv.comprobanteEnRevision).toBe(false);
    });
  });

  describe('listarMensajes', () => {
    it('entrega el pin con coordenadas y el comprobante con su validacion', async () => {
      dataSource.query.mockImplementationOnce(() =>
        Promise.resolve([
          {
            id: 'm-2',
            conversation_id: CONVERSACION,
            sender: 'cliente',
            body: '',
            attachment: { type: 'comprobante', url: 'https://r2/x.jpg' },
            client_message_id: null,
            receipt_validation_id: 'validacion-1',
            created_at: new Date(),
          },
          {
            id: 'm-1',
            conversation_id: CONVERSACION,
            sender: 'cliente',
            body: '',
            attachment: { type: 'ubicacion', lat: 20.6, lng: -100.4 },
            client_message_id: null,
            receipt_validation_id: null,
            created_at: new Date(),
          },
        ]),
      );

      const pagina = await crear().listarMensajes(JEFE, CONVERSACION, {
        limit: 5,
      });

      expect(pagina.items[0]).toMatchObject({
        attachment: { type: 'comprobante', url: 'https://r2/x.jpg' },
        receiptValidationId: 'validacion-1',
      });
      expect(pagina.items[1].attachment).toEqual({
        type: 'ubicacion',
        lat: 20.6,
        lng: -100.4,
      });
      expect(pagina.nextCursor).toBeNull();
    });
  });

  describe('tomarControl', () => {
    it('la toma, avisa al cliente y anuncia el modo solo a los jefes', async () => {
      const control = await crear().tomarControl(JEFE, CONVERSACION);

      expect(control).toMatchObject({
        mode: 'HUMAN_ACTIVE',
        humanOwnerId: 'jefe-1',
      });
      expect(textosAvisados()).toEqual([TEXTOS_DEL_EQUIPO.tomaDeControl]);
      expect(avisos.mock.calls[0][2]).toEqual({ sender: 'sistema' });
      const tiposAlCliente = realtime.emitToClient.mock.calls.map(
        (llamada) => (llamada as [string, { type: string }])[1].type,
      );
      expect(tiposAlCliente).not.toContain(CONVERSATION_MODE_CHANGED);
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        expect.arrayContaining(['jefe-1', 'jefe-2']),
        {
          type: CONVERSATION_MODE_CHANGED,
          data: {
            conversationId: CONVERSACION,
            mode: 'HUMAN_ACTIVE',
            humanOwnerId: 'jefe-1',
          },
        },
      );
    });

    it('en una carrera entre dos jefes gana uno y el otro recibe 409 con quien', async () => {
      const servicio = crear();
      const [primero, segundo] = await Promise.allSettled([
        servicio.tomarControl(JEFE, CONVERSACION),
        servicio.tomarControl(
          { id: 'jefe-2', rol: 'jefe' } as any,
          CONVERSACION,
        ),
      ]);

      expect(primero.status).toBe('fulfilled');
      expect(segundo.status).toBe('rejected');
      const error = (segundo as PromiseRejectedResult)
        .reason as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        humanOwner: { id: 'jefe-1', nombre: 'Jefa Uno' },
      });
      expect(fila.humanOwnerId).toBe('jefe-1');
      // Solo el ganador deja aviso al cliente.
      expect(avisos).toHaveBeenCalledTimes(1);
    });

    it('volver a tomar la propia no repite el aviso', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-1';

      await crear().tomarControl(JEFE, CONVERSACION);

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(avisos).not.toHaveBeenCalled();
    });

    it('el admin solo se la quita a otro si fuerza', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-1';

      await expect(crear().tomarControl(ADMIN, CONVERSACION)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        crear().tomarControl(ADMIN, CONVERSACION, true),
      ).resolves.toMatchObject({ humanOwnerId: 'admin-1' });
      // Entre dos personas del equipo el cliente no recibe aviso.
      expect(avisos).not.toHaveBeenCalled();
    });

    it('un jefe no puede forzar', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-2';
      await expect(
        crear().tomarControl(JEFE, CONVERSACION, true),
      ).rejects.toThrow(ConflictException);
    });

    it('una conversacion cerrada no se toma', async () => {
      fila.status = 'cerrada';
      await expect(crear().tomarControl(JEFE, CONVERSACION)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('liberar', () => {
    it('quita entregadaAlEquipo, rebobina el cursor y lanza el turno', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-1';
      estado.state = {
        esquema: 1,
        lifecycle: 'COLLECTING',
        entregadaAlEquipo: true,
        motivoDeEntrega: 'peticion_humana',
        fallosIaSeguidos: 2,
        ultimoMensajeAtendidoId: 'm-cliente-3',
      };
      respuestas.ultimaRespuesta = [{ id: 'm-jefe-2' }];

      const control = await crear().liberar(JEFE, CONVERSACION);
      await new Promise((resolve) => setImmediate(resolve));

      expect(control).toEqual({
        conversationId: CONVERSACION,
        mode: 'AI_ACTIVE',
        humanOwnerId: null,
        humanTakenAt: null,
      });
      expect(estado.state).toMatchObject({
        fallosIaSeguidos: 0,
        ultimoMensajeAtendidoId: 'm-jefe-2',
      });
      expect(estado.state.entregadaAlEquipo).toBeUndefined();
      expect(estado.state.motivoDeEntrega).toBeUndefined();
      expect(textosAvisados()).toEqual([
        'La asistente virtual de Valentina retoma la conversación.',
      ]);
      expect(turnHandler.procesarPendientes).toHaveBeenCalledWith(CONVERSACION);
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ type: CONVERSATION_MODE_CHANGED }),
      );
    });

    it('no pisa lo que la IA guardo a la vez: relee y vuelve a aplicar', async () => {
      estado.state = { esquema: 1, lifecycle: 'IDLE', entregadaAlEquipo: true };
      conflictosDeEstado = 1;

      await crear().liberar(JEFE, CONVERSACION);

      expect(store.save).toHaveBeenCalledTimes(2);
      expect(estado.state.entregadaAlEquipo).toBeUndefined();
    });

    it('si la tiene otro jefe responde 409', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-2';
      await expect(crear().liberar(JEFE, CONVERSACION)).rejects.toThrow(
        ConflictException,
      );
      expect(store.save).not.toHaveBeenCalled();
    });

    it('sin nada en manos del equipo no avisa al cliente', async () => {
      await crear().liberar(JEFE, CONVERSACION);
      expect(avisos).not.toHaveBeenCalled();
    });
  });

  describe('enviarMensaje', () => {
    const dto = {
      body: 'Hola, ya casi 😘',
      clientMessageId: CLIENT_MESSAGE_ID,
    };

    it('responde 409 si la conversacion no esta en modo humano', async () => {
      await expect(
        crear().enviarMensaje(JEFE, CONVERSACION, dto),
      ).rejects.toThrow(/Toma el control/);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('responde 409 si la tomo otra persona', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-2';
      await expect(
        crear().enviarMensaje(JEFE, CONVERSACION, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('el dueño escribe como jefe, sin emojis, y se avisa a cliente y jefes', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-1';

      const { message, creado } = await crear().enviarMensaje(
        JEFE,
        CONVERSACION,
        dto,
      );

      expect(creado).toBe(true);
      expect(manager.create).toHaveBeenCalledWith(Message, {
        conversationId: CONVERSACION,
        sender: 'jefe',
        body: 'Hola, ya casi',
        clientMessageId: CLIENT_MESSAGE_ID,
      });
      expect(message).toMatchObject({ sender: 'jefe', body: 'Hola, ya casi' });
      const evento = {
        type: MESSAGE_CREATED,
        data: { conversationId: CONVERSACION, messageId: 'mensaje-1' },
      };
      expect(realtime.emitToClient).toHaveBeenCalledWith('cliente-1', evento);
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        expect.arrayContaining(['jefe-1', 'jefe-2']),
        evento,
      );
    });

    it('el admin puede escribir aunque la tenga un jefe', async () => {
      fila.mode = 'HUMAN_ACTIVE';
      fila.humanOwnerId = 'jefe-1';
      await expect(
        crear().enviarMensaje(ADMIN, CONVERSACION, dto),
      ).resolves.toMatchObject({ creado: true });
    });

    it('el reintento devuelve el mismo mensaje sin avisar', async () => {
      mensajeExistente = {
        id: 'mensaje-0',
        conversationId: CONVERSACION,
        sender: 'jefe',
        body: 'Hola, ya casi',
        clientMessageId: CLIENT_MESSAGE_ID,
        createdAt: new Date(),
      } as Message;

      const { message, creado } = await crear().enviarMensaje(
        JEFE,
        CONVERSACION,
        dto,
      );

      expect(creado).toBe(false);
      expect(message.id).toBe('mensaje-0');
      expect(realtime.emitToClient).not.toHaveBeenCalled();
    });

    it('un mensaje que se queda vacio sin emojis es 400', async () => {
      await expect(
        crear().enviarMensaje(JEFE, CONVERSACION, {
          body: '😘',
          clientMessageId: CLIENT_MESSAGE_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('aceptar', () => {
    it('con un cliente sin Telegram crea el servicio, enlaza la conversacion y el comprobante', async () => {
      estado.state = {
        esquema: 1,
        lifecycle: 'READY',
        metodoPago: 'transferencia',
        esperandoComprobante: true,
        paso: 'AWAITING_PAYMENT_RECEIPT',
      };
      fila.state = estado.state as Record<string, unknown>;
      respuestas.comprobante = [{ id: 'validacion-1' }];

      const decision = await crear().aceptar(JEFE, CONVERSACION);

      expect(decision).toEqual({
        conversationId: CONVERSACION,
        status: 'con_servicio',
        bookingSessionId: 'borrador-1',
        serviceId: 'servicio-1',
        idempotent: false,
      });
      expect(servicesService.reserveNext).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId: 'cliente-1',
          bookingSessionId: 'borrador-1',
          clienteTelegramId: null,
          comprobantePendiente: true,
          jefeId: 'jefe-1',
        }),
      );
      expect(servicesService.ofrecerAEmpleada).toHaveBeenCalledWith(
        'servicio-1',
        'jefe-1',
        'chofer',
        undefined,
        undefined,
      );
      expect(fila).toMatchObject({
        serviceId: 'servicio-1',
        status: 'con_servicio',
      });
      expect(validacionesRepository.update).toHaveBeenCalledWith(
        'validacion-1',
        { servicioId: 'servicio-1' },
      );
      expect(estado.state).toMatchObject({ lifecycle: 'SERVICE_CREATED' });
      expect(estado.state.esperandoComprobante).toBeUndefined();
      expect(textosAvisados()).toEqual([
        TEXTOS_DEL_EQUIPO.solicitudAprobada('Valentina'),
      ]);
      expect(realtime.emitToClient).toHaveBeenCalledWith('cliente-1', {
        type: CONVERSATION_STATUS_CHANGED,
        data: { conversationId: CONVERSACION, status: 'con_servicio' },
      });
    });

    it('sin comprobante pendiente no enlaza nada', async () => {
      await crear().aceptar(JEFE, CONVERSACION);
      expect(validacionesRepository.update).not.toHaveBeenCalled();
    });

    it('un jefe de relevo se queda con el servicio', async () => {
      modelo.jefe = { ...atiende('jefe-1'), activo: false };
      modelo.jefeSecundario = { ...atiende('jefe-2'), disponible: false };

      await crear().aceptar(OTRO_JEFE, CONVERSACION);

      expect(servicesService.reserveNext).toHaveBeenCalledWith(
        expect.objectContaining({ jefeId: 'jefe-9' }),
      );
    });

    it('un borrador ya aceptado no crea otro servicio ni repite el aviso', async () => {
      borrador.serviceId = 'servicio-1';
      borrador.status = 'SERVICE_CREATED';

      const decision = await crear().aceptar(JEFE, CONVERSACION);

      expect(decision.idempotent).toBe(true);
      expect(servicesService.reserveNext).not.toHaveBeenCalled();
      expect(avisos).not.toHaveBeenCalled();
    });

    it('sin borrador responde 409', async () => {
      fila.bookingSessionId = null;
      await expect(crear().aceptar(JEFE, CONVERSACION)).rejects.toThrow(
        ConflictException,
      );
    });

    it('un borrador rechazado no se acepta', async () => {
      borrador.status = 'CANCELLED';
      await expect(crear().aceptar(JEFE, CONVERSACION)).rejects.toThrow(
        ConflictException,
      );
      expect(servicesService.reserveNext).not.toHaveBeenCalled();
    });
  });

  describe('rechazar', () => {
    it('cancela el borrador, deja la conversacion activa y avisa sin vocabulario vetado', async () => {
      estado.state = {
        esquema: 1,
        lifecycle: 'READY',
        metodoPago: 'efectivo',
        duracionPactadaHoras: 2,
        bookingSessionId: 'borrador-1',
        entregadaAlEquipo: true,
        motivoDeEntrega: 'peticion_humana',
        ultimoMensajeAtendidoId: 'm-5',
      };

      const decision = await crear().rechazar(JEFE, CONVERSACION, 'sin cupo');

      expect(decision).toEqual({
        conversationId: CONVERSACION,
        status: 'activa',
        bookingSessionId: null,
        serviceId: null,
        idempotent: false,
      });
      expect(borrador.status).toBe('CANCELLED');
      const [, params] = dataSource.query.mock.calls.find((llamada) =>
        (llamada[0] as string).includes('WITH cancelado'),
      ) as [string, unknown[]];
      expect(JSON.parse(params[1] as string)).toMatchObject({
        rechazo: { motivo: 'sin cupo', porUsuarioId: 'jefe-1' },
      });
      expect(fila.bookingSessionId).toBeNull();
      expect(estado.state).toMatchObject({
        lifecycle: 'IDLE',
        entregadaAlEquipo: true,
        motivoDeEntrega: 'peticion_humana',
        ultimoMensajeAtendidoId: 'm-5',
      });
      expect(estado.state.metodoPago).toBeUndefined();
      expect(estado.state.bookingSessionId).toBeUndefined();
      expect(textosAvisados()).toEqual([TEXTOS_DEL_EQUIPO.solicitudRechazada]);
    });

    it('no rechaza una solicitud que ya es servicio', async () => {
      borrador.serviceId = 'servicio-1';
      await expect(crear().rechazar(JEFE, CONVERSACION)).rejects.toThrow(
        ConflictException,
      );
    });

    it('si se esta aceptando a la vez responde 409', async () => {
      borrador.status = 'ACCEPTING';
      await expect(crear().rechazar(JEFE, CONVERSACION)).rejects.toThrow(
        /aceptada por otra persona/,
      );
      expect(avisos).not.toHaveBeenCalled();
    });
  });

  describe('textos al cliente', () => {
    const textos = [
      TEXTOS_DEL_EQUIPO.tomaDeControl,
      TEXTOS_DEL_EQUIPO.retomaAsistente('Valentina'),
      TEXTOS_DEL_EQUIPO.retomaAsistenteGenerico,
      TEXTOS_DEL_EQUIPO.solicitudAprobada('Valentina'),
      TEXTOS_DEL_EQUIPO.solicitudAprobadaGenerica,
      TEXTOS_DEL_EQUIPO.solicitudRechazada,
    ];

    it.each(textos)('"%s" no lleva palabras vetadas ni emojis', (texto) => {
      expect(palabrasVetadasEn(texto)).toEqual([]);
      expect(quitarEmojis(texto)).toBe(texto);
    });

    it('un nombre artistico con palabra vetada cae al texto generico', () => {
      expect(
        textoSeguro(
          TEXTOS_DEL_EQUIPO.retomaAsistente('Modelo Vip'),
          TEXTOS_DEL_EQUIPO.retomaAsistenteGenerico,
        ),
      ).toBe(TEXTOS_DEL_EQUIPO.retomaAsistenteGenerico);
    });
  });

  describe('jefeDelServicio', () => {
    const empleada = { jefeId: 'jefe-1', jefeSecundarioId: 'jefe-2' };
    it('el secundario y el admin dejan al principal', () => {
      expect(jefeDelServicio({ id: 'jefe-2', rol: 'jefe' }, empleada)).toBe(
        'jefe-1',
      );
      expect(jefeDelServicio({ id: 'admin-1', rol: 'admin' }, empleada)).toBe(
        'jefe-1',
      );
    });
    it('el relevo se lo queda', () => {
      expect(jefeDelServicio({ id: 'jefe-9', rol: 'jefe' }, empleada)).toBe(
        'jefe-9',
      );
    });
  });
});
