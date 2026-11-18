import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Empleadas } from '../employees/entities/employee.entity';
import { PaymentReceiptValidations } from '../services/entities/payment-receipt-validation.entity';
import { Servicios } from '../services/entities/service.entity';
import { MESSAGE_CREATED, RECEIPT_STATUS } from './conversation-events';
import {
  ConversationReceiptsService,
  TEXTOS_DEL_COMPROBANTE,
} from './conversation-receipts.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { WebChatChannel } from './web-chat-channel';

const USUARIO = 'usuario-1';
const CLIENTE = 'cliente-1';
const MODELO = 'empleada-1';
const CONVERSACION = '11111111-1111-4111-8111-111111111111';
const CLIENT_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const URL_R2 =
  'https://media.example.com/evidencias/transferencias/conv/foto.jpg';

const CUENTA = {
  activa: true,
  banco: 'BBVA',
  titular: 'Omar Pérez',
  cuenta: '4152314214309919',
  ultimos4: '9919',
};

/** Lo que devuelve el analizador para una foto buena de 2500. */
const ANALISIS_BUENO = {
  esComprobante: true,
  monto: '2500.00',
  cuentaDestino: '****9919',
  titularDestino: 'Omar Pérez',
  idSpei: 'MBAN01002611160001',
};

/** Reserva de 1 hora a 2500 por transferencia, esperando comprobante. */
function estadoEsperando(extra: Record<string, unknown> = {}) {
  return {
    esquema: 1,
    lifecycle: 'READY',
    metodoPago: 'transferencia',
    duracionPactadaHoras: 1,
    customerTransportCharge: 0,
    esperandoComprobante: true,
    ...extra,
  };
}

function conversacion(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSACION,
    clientId: CLIENTE,
    employeeId: MODELO,
    status: 'en_revision',
    mode: 'AI_ACTIVE',
    bookingSessionId: 'borrador-1',
    serviceId: null,
    state: estadoEsperando(),
    lastMessageAt: null,
    ...overrides,
  } as unknown as Conversation;
}

const ARCHIVO = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };

/** Deja correr el analisis que la subida lanza sin esperar. */
const drenar = () => new Promise((resolve) => setImmediate(resolve));

describe('ConversationReceiptsService', () => {
  let conv: Conversation;
  let mensajeExistente: Message | null;
  let servicioPendiente: Partial<Servicios> | null;
  let ultimoComprobante: Array<{ estado: string; created_at: Date }>;
  let claveConfirmada: unknown[];
  let validaciones: { create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let conversationsRepository: { findOne: jest.Mock };
  let clientesRepository: { findOne: jest.Mock };
  let empleadasRepository: { findOne: jest.Mock };
  let serviciosRepository: { findOne: jest.Mock };
  let cuentasRepository: { find: jest.Mock };
  let uploadService: { uploadEvidence: jest.Mock };
  let aiProvider: { analyzeReceipt: jest.Mock };
  let realtime: {
    emitToClient: jest.Mock;
    emitToBosses: jest.Mock;
    emitToBoss: jest.Mock;
  };
  let notificar: jest.SpyInstance;
  let enviar: jest.SpyInstance;

  function crear(): ConversationReceiptsService {
    return new ConversationReceiptsService(
      dataSource as any,
      conversationsRepository as any,
      { manager } as any,
      clientesRepository as any,
      empleadasRepository as any,
      serviciosRepository as any,
      validaciones as any,
      cuentasRepository as any,
      uploadService as any,
      aiProvider as any,
      realtime as any,
    );
  }

  beforeEach(() => {
    conv = conversacion();
    mensajeExistente = null;
    servicioPendiente = null;
    ultimoComprobante = [];
    claveConfirmada = [];
    validaciones = {
      create: jest.fn((datos: object) => ({ ...datos })),
      save: jest.fn((v: object) =>
        Promise.resolve({ id: 'validacion-1', createdAt: new Date(), ...v }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
    manager = {
      findOne: jest.fn((entidad: unknown) => {
        if (entidad === Message) return Promise.resolve(mensajeExistente);
        if (entidad === Conversation) return Promise.resolve(conv);
        if (entidad === Servicios) return Promise.resolve(servicioPendiente);
        if (entidad === Empleadas)
          return Promise.resolve({ id: MODELO, precioBaseHora: 2500 });
        return Promise.resolve(null);
      }),
      create: jest.fn((_entidad: unknown, datos: object) => ({ ...datos })),
      save: jest.fn((datos: object) =>
        Promise.resolve({
          id: 'mensaje-1',
          createdAt: new Date('2026-11-16T20:00:00Z'),
          ...datos,
        }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(() => Promise.resolve(ultimoComprobante)),
      getRepository: jest.fn((entidad: unknown) =>
        entidad === PaymentReceiptValidations ? validaciones : null,
      ),
    };
    dataSource = {
      query: jest.fn(() => Promise.resolve(claveConfirmada)),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    conversationsRepository = {
      findOne: jest.fn(() => Promise.resolve(conv)),
    };
    clientesRepository = {
      findOne: jest.fn().mockResolvedValue({ id: CLIENTE }),
    };
    empleadasRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: MODELO,
        jefeId: 'jefe-1',
        jefeSecundarioId: null,
      }),
    };
    serviciosRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'servicio-1',
        estado: 'pendiente',
        jefeId: 'jefe-1',
      }),
    };
    cuentasRepository = { find: jest.fn().mockResolvedValue([CUENTA]) };
    uploadService = {
      uploadEvidence: jest
        .fn()
        .mockResolvedValue({ url: URL_R2, key: 'evidencias/x.jpg' }),
    };
    aiProvider = {
      analyzeReceipt: jest.fn().mockResolvedValue(ANALISIS_BUENO),
    };
    realtime = {
      emitToClient: jest.fn(),
      emitToBosses: jest.fn(),
      emitToBoss: jest.fn(),
    };
    notificar = jest
      .spyOn(WebChatChannel.prototype, 'notificarAlEquipo')
      .mockResolvedValue(undefined);
    enviar = jest
      .spyOn(WebChatChannel.prototype, 'sendText')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('subirComprobante', () => {
    it('responde 404 con una conversacion ajena o inexistente', async () => {
      conversationsRepository.findOne.mockResolvedValue(null);

      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).rejects.toThrow(NotFoundException);
      expect(conversationsRepository.findOne).toHaveBeenCalledWith({
        where: { id: CONVERSACION, clientId: CLIENTE },
      });
      expect(uploadService.uploadEvidence).not.toHaveBeenCalled();
    });

    it('responde 404 si la cuenta no tiene ficha de cliente', async () => {
      clientesRepository.findOne.mockResolvedValue(null);
      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('responde 409 si no hay pago por transferencia pendiente', async () => {
      conv = conversacion({ state: { esquema: 1, lifecycle: 'COLLECTING' } });

      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).rejects.toThrow(
        new ConflictException(
          'No hay ningún pago por transferencia pendiente de comprobante en esta conversación',
        ),
      );
      expect(uploadService.uploadEvidence).not.toHaveBeenCalled();
    });

    it('responde 409 con la conversacion cerrada', async () => {
      conv = conversacion({ status: 'cerrada' });
      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('responde 409 si ya hay un comprobante en revision', async () => {
      ultimoComprobante = [
        { estado: 'PENDIENTE_REVISION', created_at: new Date() },
      ];
      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).rejects.toThrow(/Ya recibimos tu comprobante/);
      expect(uploadService.uploadEvidence).not.toHaveBeenCalled();
    });

    it('admite otro si el anterior fue rechazado', async () => {
      ultimoComprobante = [{ estado: 'RECHAZADO', created_at: new Date() }];
      const { creado } = await crear().subirComprobante(
        USUARIO,
        CONVERSACION,
        ARCHIVO,
        {},
      );
      expect(creado).toBe(true);
    });

    it('acepta el servicio por transferencia que sigue esperando comprobante', async () => {
      conv = conversacion({
        state: { esquema: 1, lifecycle: 'READY' },
        serviceId: 'servicio-1',
        status: 'con_servicio',
      });
      servicioPendiente = {
        id: 'servicio-1',
        serviceType: 'individual',
        metodoPago: 'transferencia',
        comprobantePendiente: true,
      };

      const { creado } = await crear().subirComprobante(
        USUARIO,
        CONVERSACION,
        ARCHIVO,
        {},
      );
      expect(creado).toBe(true);
    });

    it('rechaza el servicio individual que ya no espera comprobante', async () => {
      conv = conversacion({
        state: { esquema: 1, lifecycle: 'READY' },
        serviceId: 'servicio-1',
        status: 'con_servicio',
      });
      servicioPendiente = {
        id: 'servicio-1',
        serviceType: 'individual',
        metodoPago: 'transferencia',
        comprobantePendiente: false,
      };

      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).rejects.toThrow(ConflictException);
    });

    describe('servicio grupal cotizado desde el panel', () => {
      beforeEach(() => {
        conv = conversacion({
          state: { esquema: 1, lifecycle: 'COLLECTING' },
          serviceId: 'servicio-1',
          status: 'con_servicio',
        });
        servicioPendiente = {
          id: 'servicio-1',
          serviceType: 'grupal',
          metodoPago: 'transferencia',
          comprobantePendiente: false,
          pendingBalance: 3600.5,
          jefeId: 'jefe-organizador',
        };
      });

      it('cobra el saldo con el jefe que organizo el grupo', async () => {
        const { creado } = await crear().subirComprobante(
          USUARIO,
          CONVERSACION,
          ARCHIVO,
          {},
        );
        await drenar();

        expect(creado).toBe(true);
        expect(validaciones.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tipoCobro: 'grupal',
            servicioId: 'servicio-1',
          }),
        );
        expect(aiProvider.analyzeReceipt).toHaveBeenCalledWith(URL_R2, 3600.5);
        expect(validaciones.save).toHaveBeenLastCalledWith(
          expect.objectContaining({
            jefeId: 'jefe-organizador',
            montoEsperado: 3600.5,
          }),
        );
      });

      it('responde 409 si el grupo ya no tiene saldo', async () => {
        servicioPendiente = { ...servicioPendiente, pendingBalance: 0 };
        await expect(
          crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
        ).rejects.toThrow(ConflictException);
        expect(uploadService.uploadEvidence).not.toHaveBeenCalled();
      });

      it('responde 409 si el grupo no se paga por transferencia', async () => {
        servicioPendiente = { ...servicioPendiente, metodoPago: 'mixto' };
        await expect(
          crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
        ).rejects.toThrow(ConflictException);
      });
    });

    it('responde 400 sin archivo', async () => {
      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, undefined, {}),
      ).rejects.toThrow(BadRequestException);
    });

    /** El tipo real lo decide `uploadEvidence` por los bytes. */
    it('deja que uploadEvidence rechace un archivo que no es imagen', async () => {
      uploadService.uploadEvidence.mockRejectedValue(
        new BadRequestException(
          'La evidencia recibida no tiene un formato de imagen compatible',
        ),
      );

      await expect(
        crear().subirComprobante(
          USUARIO,
          CONVERSACION,
          { buffer: Buffer.from('<html>'), mimetype: 'image/png' },
          {},
        ),
      ).rejects.toThrow(BadRequestException);
      expect(uploadService.uploadEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: '' }),
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('guarda la foto, el mensaje y la validacion y responde con la URL', async () => {
      const { message, creado } = await crear().subirComprobante(
        USUARIO,
        CONVERSACION,
        ARCHIVO,
        { clientMessageId: CLIENT_MESSAGE_ID },
      );

      expect(creado).toBe(true);
      expect(uploadService.uploadEvidence).toHaveBeenCalledWith({
        buffer: ARCHIVO.buffer,
        contentType: '',
        folder: 'transferencias',
        scopeId: CONVERSACION,
      });
      expect(validaciones.create).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'PROCESANDO',
          imageUrl: URL_R2,
          tipoCobro: 'reserva',
          chatId: undefined,
          telegramFileId: undefined,
        }),
      );
      expect(manager.create).toHaveBeenCalledWith(Message, {
        conversationId: CONVERSACION,
        sender: 'cliente',
        body: '',
        attachment: {
          type: 'comprobante',
          url: URL_R2,
          sizeBytes: ARCHIVO.buffer.length,
        },
        receiptValidationId: 'validacion-1',
        clientMessageId: CLIENT_MESSAGE_ID,
      });
      expect(message).toMatchObject({
        id: 'mensaje-1',
        sender: 'cliente',
        attachment: { type: 'comprobante', url: URL_R2 },
      });
      expect(realtime.emitToClient).toHaveBeenCalledWith(CLIENTE, {
        type: MESSAGE_CREATED,
        data: { conversationId: CONVERSACION, messageId: 'mensaje-1' },
      });
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        ['jefe-1', null],
        expect.objectContaining({ type: MESSAGE_CREATED }),
      );
      // La conversacion se bloquea para registrar el comprobante.
      expect(manager.findOne).toHaveBeenCalledWith(Conversation, {
        where: { id: CONVERSACION, clientId: CLIENTE },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('un reintento con el mismo clientMessageId no duplica nada', async () => {
      mensajeExistente = {
        id: 'mensaje-0',
        conversationId: CONVERSACION,
        sender: 'cliente',
        body: '',
        attachment: { type: 'comprobante', url: URL_R2 },
        receiptValidationId: 'validacion-0',
        clientMessageId: CLIENT_MESSAGE_ID,
        createdAt: new Date(),
      } as Message;

      const { message, creado } = await crear().subirComprobante(
        USUARIO,
        CONVERSACION,
        ARCHIVO,
        { clientMessageId: CLIENT_MESSAGE_ID },
      );

      expect(creado).toBe(false);
      expect(message.id).toBe('mensaje-0');
      expect(uploadService.uploadEvidence).not.toHaveBeenCalled();
      expect(aiProvider.analyzeReceipt).not.toHaveBeenCalled();
      expect(realtime.emitToClient).not.toHaveBeenCalled();
    });

    /** El analisis corre despues: su fallo no convierte la subida en error. */
    it('un fallo de la IA no tumba la peticion', async () => {
      aiProvider.analyzeReceipt.mockRejectedValue(new Error('sin clave'));

      await expect(
        crear().subirComprobante(USUARIO, CONVERSACION, ARCHIVO, {}),
      ).resolves.toMatchObject({ creado: true });
      await drenar();

      expect(realtime.emitToClient).toHaveBeenCalledWith(CLIENTE, {
        type: RECEIPT_STATUS,
        data: {
          conversationId: CONVERSACION,
          messageId: 'mensaje-1',
          status: 'error',
        },
      });
    });

    it('no espera al analisis para responder', async () => {
      let resolver: (v: unknown) => void = () => undefined;
      aiProvider.analyzeReceipt.mockReturnValue(
        new Promise((resolve) => (resolver = resolve)),
      );

      const { creado } = await crear().subirComprobante(
        USUARIO,
        CONVERSACION,
        ARCHIVO,
        {},
      );
      expect(creado).toBe(true);
      expect(notificar).not.toHaveBeenCalled();

      resolver(ANALISIS_BUENO);
      await drenar();
      expect(notificar).toHaveBeenCalled();
    });
  });

  describe('analizar', () => {
    function recibido(
      cobro: {
        montoEsperado: number | null;
        servicioId: string | null;
      } = { montoEsperado: 2500, servicioId: null },
    ) {
      return {
        conversation: conversacion(),
        messageId: 'mensaje-1',
        validation: {
          id: 'validacion-1',
          estado: 'PROCESANDO',
        } as PaymentReceiptValidations,
        imageUrl: URL_R2,
        cobro: { tipoCobro: 'reserva' as const, ...cobro },
      };
    }

    function estadoEmitido(): string | undefined {
      const evento = realtime.emitToClient.mock.calls
        .map(([, e]) => e as { type: string; data: { status?: string } })
        .find((e) => e.type === RECEIPT_STATUS);
      return evento?.data.status;
    }

    it('una foto que cuadra queda recibida, sin dar el pago por confirmado', async () => {
      await expect(crear().analizar(recibido())).resolves.toBe('recibido');

      expect(aiProvider.analyzeReceipt).toHaveBeenCalledWith(URL_R2, 2500);
      expect(validaciones.save).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'APROBADO',
          montoEsperado: 2500,
          jefeId: 'jefe-1',
          idSpei: 'MBAN01002611160001',
        }),
      );
      const guardada = validaciones.save.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(guardada.pagoConfirmadoAt).toBeUndefined();
      expect(notificar).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: CONVERSACION }),
        expect.objectContaining({
          motivo: 'comprobante_recibido',
          mensajeAlCliente: TEXTOS_DEL_COMPROBANTE.recibido,
        }),
      );
      expect(estadoEmitido()).toBe('recibido');
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        ['jefe-1', null],
        expect.objectContaining({ type: RECEIPT_STATUS }),
      );
    });

    it('lo que no se lee con certeza queda en revision del equipo', async () => {
      aiProvider.analyzeReceipt.mockResolvedValue({ aiCallFailed: true });

      await expect(crear().analizar(recibido())).resolves.toBe('en_revision');
      expect(validaciones.save).toHaveBeenCalledWith(
        expect.objectContaining({ estado: 'PENDIENTE_REVISION' }),
      );
      expect(notificar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mensajeAlCliente: TEXTOS_DEL_COMPROBANTE.enRevision,
        }),
      );
      expect(estadoEmitido()).toBe('en_revision');
    });

    it('sin monto acordado nunca se aprueba sola', async () => {
      await expect(
        crear().analizar(recibido({ montoEsperado: null, servicioId: null })),
      ).resolves.toBe('en_revision');
      expect(validaciones.save).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'PENDIENTE_REVISION',
          observaciones: TEXTOS_DEL_COMPROBANTE.sinMontoEsperado,
        }),
      );
    });

    it('una clave de rastreo que ya confirmo otro pago pide otro comprobante', async () => {
      claveConfirmada = [{ '?column?': 1 }];

      await expect(crear().analizar(recibido())).resolves.toBe('rechazado');
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('pago_confirmado_at IS NOT NULL');
      expect(params).toEqual(['MBAN01002611160001', 'validacion-1']);
      expect(validaciones.save).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'RECHAZADO',
          observaciones: TEXTOS_DEL_COMPROBANTE.duplicado,
        }),
      );
      expect(notificar).not.toHaveBeenCalled();
      const [, texto, opciones] = enviar.mock.calls[0] as [
        unknown,
        string,
        { sender: string },
      ];
      expect(opciones.sender).toBe('sistema');
      expect(texto).toContain('clave de rastreo ya se usó');
      expect(texto).toContain('Envía otro comprobante');
      expect(estadoEmitido()).toBe('rechazado');
    });

    it('un monto menor que el acordado pide otro comprobante', async () => {
      aiProvider.analyzeReceipt.mockResolvedValue({
        ...ANALISIS_BUENO,
        monto: '1000',
      });
      await expect(crear().analizar(recibido())).resolves.toBe('rechazado');
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('un fallo del analizador deja la validacion en error sin lanzar', async () => {
      aiProvider.analyzeReceipt.mockRejectedValue(new Error('sin clave'));
      const entrada = recibido();

      await expect(crear().analizar(entrada)).resolves.toBe('error');
      expect(entrada.validation.estado).toBe('ERROR_VALIDACION');
      expect(notificar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mensajeAlCliente: TEXTOS_DEL_COMPROBANTE.error,
        }),
      );
    });

    it('engancha el comprobante al servicio que lo esperaba', async () => {
      await crear().analizar(
        recibido({ montoEsperado: 2500, servicioId: 'servicio-1' }),
      );
      expect(validaciones.update).toHaveBeenCalledWith('validacion-1', {
        servicioId: 'servicio-1',
      });
      expect(realtime.emitToBoss).toHaveBeenCalledWith(
        'jefe-1',
        expect.objectContaining({ type: 'service_updated' }),
      );
    });

    it('no engancha un comprobante rechazado', async () => {
      aiProvider.analyzeReceipt.mockResolvedValue({ esComprobante: false });
      await crear().analizar(
        recibido({ montoEsperado: 2500, servicioId: 'servicio-1' }),
      );
      expect(validaciones.update).not.toHaveBeenCalled();
    });
  });

  it('los textos del sistema no llevan emojis', () => {
    for (const texto of Object.values(TEXTOS_DEL_COMPROBANTE)) {
      expect(texto).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
