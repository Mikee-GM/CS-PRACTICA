import { ConflictException, NotFoundException } from '@nestjs/common';
import { palabrasVetadasEn } from '../ai/vocabulario-vetado';
import { CONVERSATION_MODE_CHANGED } from '../conversations/conversation-events';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../conversations/entities/message.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import {
  GrupoEnChatWebService,
  TEXTOS_DEL_GRUPO_WEB,
  textoDeCotizacion,
  textoDeSaldo,
  type ServicioCotizable,
} from './grupo-en-chat-web.service';

const CONVERSACION = '11111111-1111-4111-8111-111111111111';
const MODELO = 'empleada-1';

const CUENTA = {
  activa: true,
  banco: 'BBVA',
  titular: 'Omar Pérez',
  cuenta: '4152314214309919',
};

function servicio(extra: Partial<ServicioCotizable> = {}): ServicioCotizable {
  return {
    id: 'servicio-1',
    metodoPago: 'transferencia',
    duracionPactadaHoras: 2,
    totalFinal: 9000.1,
    totalPaid: 0,
    pendingBalance: 9000.1,
    customerTransportCharge: 600,
    participantes: [
      { status: 'reservada', employee: { nombreArtistico: 'Ana' } },
      { status: 'pendiente_pago', employee: { nombreArtistico: 'Luna' } },
      { status: 'cancelada', employee: { nombreArtistico: 'Sofía' } },
    ],
    ...extra,
  } as ServicioCotizable;
}

/** Quita espacios duros que `Intl` mete entre el signo y la cifra. */
const plano = (texto: string) => texto.replace(/\s/g, ' ');

describe('textos del grupo en el chat web', () => {
  it('la cotizacion lleva participantes vivas, duracion, traslado y total', () => {
    const texto = plano(textoDeCotizacion(servicio(), null));
    expect(texto).toContain('Te acompañan: Ana, Luna');
    expect(texto).not.toContain('Sofía');
    expect(texto).toContain('Duración: 2 horas');
    expect(texto).toContain('Traslado: $600.00');
    expect(texto).toContain('Total: $9,000.10');
    expect(texto).toContain('Saldo por transferir: $9,000.10');
  });

  it('con cuentas las enumera para transferir', () => {
    const texto = textoDeCotizacion(servicio(), '1. BBVA\nTitular: Omar');
    expect(texto).toContain('1. BBVA');
    expect(texto).toContain('envía aquí la foto o captura del comprobante');
  });

  it('en efectivo no pide transferencia ni comprobante', () => {
    const texto = textoDeCotizacion(
      servicio({ metodoPago: 'efectivo' }),
      'cuentas',
    );
    expect(texto).toContain('Forma de pago: efectivo');
    expect(texto).not.toContain('Saldo por transferir');
    expect(texto).not.toContain('comprobante');
  });

  it('muestra lo pagado cuando ya hay pagos', () => {
    const texto = plano(
      textoDeCotizacion(
        servicio({ totalPaid: 4000, pendingBalance: 5000.1 }),
        null,
      ),
    );
    expect(texto).toContain('Pagado: $4,000.00');
    expect(texto).toContain('Saldo por transferir: $5,000.10');
  });

  it('ningun texto fijo dice lo que el cliente no debe leer', () => {
    const textos = [
      TEXTOS_DEL_GRUPO_WEB.pedirUbicacion,
      TEXTOS_DEL_GRUPO_WEB.comprobanteRechazado('La imagen no es legible'),
      TEXTOS_DEL_GRUPO_WEB.comprobanteRechazadoGenerico,
      TEXTOS_DEL_GRUPO_WEB.pagoCompleto,
      textoDeCotizacion(servicio(), null),
      textoDeCotizacion(servicio({ metodoPago: 'tarjeta' }), null),
      textoDeSaldo(150000, null),
      textoDeSaldo(150000, 'cuentas'),
    ];
    for (const texto of textos) {
      expect(palabrasVetadasEn(texto)).toEqual([]);
      expect(texto).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('GrupoEnChatWebService', () => {
  let dataSource: { query: jest.Mock; getRepository: jest.Mock };
  let conversaciones: { findOne: jest.Mock };
  let mensajes: { find: jest.Mock };
  let empleadas: { findOne: jest.Mock; find: jest.Mock };
  let cuentas: { find: jest.Mock };
  let notifier: { escribir: jest.Mock };
  let realtime: { emitToBosses: jest.Mock };
  let web: GrupoEnChatWebService;

  const request = {
    id: 'solicitud-1',
    clientId: 'cliente-1',
    serviceId: null,
    conversationId: CONVERSACION,
  } as any;

  beforeEach(() => {
    conversaciones = { findOne: jest.fn() };
    mensajes = { find: jest.fn().mockResolvedValue([]) };
    empleadas = {
      findOne: jest.fn().mockResolvedValue({
        id: MODELO,
        jefeId: 'jefe-1',
        jefeSecundarioId: null,
        jefe: { id: 'jefe-1', activo: true, disponible: true, enJornada: true },
        jefeSecundario: null,
      }),
      find: jest.fn().mockResolvedValue([]),
    };
    cuentas = { find: jest.fn().mockResolvedValue([CUENTA]) };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entidad: unknown) => {
        if (entidad === Conversation) return conversaciones;
        if (entidad === Message) return mensajes;
        if (entidad === Empleadas) return empleadas;
        if (entidad === AuthorizedBankAccounts) return cuentas;
        return null;
      }),
    };
    notifier = {
      escribir: jest.fn((entrada: { texto: string; sender: string }) =>
        Promise.resolve({
          id: 'mensaje-1',
          conversationId: CONVERSACION,
          sender: entrada.sender,
          body: entrada.texto,
          attachment: null,
          createdAt: new Date('2026-11-17T03:00:00Z'),
        }),
      ),
    };
    realtime = { emitToBosses: jest.fn() };
    web = new GrupoEnChatWebService(
      dataSource as any,
      notifier as any,
      realtime as any,
    );
  });

  describe('conversacionParaGrupo', () => {
    it('responde 404 con una conversacion de una modelo ajena', async () => {
      conversaciones.findOne.mockResolvedValue({
        id: CONVERSACION,
        employeeId: MODELO,
        status: 'en_revision',
      });
      await expect(
        web.conversacionParaGrupo(CONVERSACION, {
          id: 'otro-jefe',
          rol: 'jefe',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('responde 409 con la conversacion cerrada', async () => {
      conversaciones.findOne.mockResolvedValue({
        id: CONVERSACION,
        employeeId: MODELO,
        status: 'cerrada',
      });
      await expect(
        web.conversacionParaGrupo(CONVERSACION, { id: 'jefe-1', rol: 'jefe' }),
      ).rejects.toThrow(ConflictException);
    });

    it('devuelve la conversacion del jefe de la modelo', async () => {
      const conversation = {
        id: CONVERSACION,
        employeeId: MODELO,
        status: 'en_revision',
      };
      conversaciones.findOne.mockResolvedValue(conversation);
      await expect(
        web.conversacionParaGrupo(CONVERSACION, { id: 'jefe-1', rol: 'jefe' }),
      ).resolves.toBe(conversation);
    });
  });

  describe('tomarControl', () => {
    const conversation = {
      id: CONVERSACION,
      employeeId: MODELO,
      mode: 'AI_ACTIVE',
    } as Conversation;

    it('toma la conversacion sin avisar al cliente y anuncia el modo', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: CONVERSACION }]);
      await web.tomarControl(conversation, 'jefe-1');

      const [sql, parametros] = dataSource.query.mock.calls[0];
      expect(sql).toContain("mode = 'HUMAN_ACTIVE'");
      expect(sql).toContain("(mode = 'AI_ACTIVE' OR human_owner_id IS NULL)");
      expect(parametros).toEqual([CONVERSACION, 'jefe-1']);
      // El cliente no se entera del traspaso: lo que escriba el equipo se le
      // pinta como de la modelo.
      expect(notifier.escribir).not.toHaveBeenCalled();
      expect(realtime.emitToBosses).toHaveBeenCalledWith(
        ['jefe-1', null, 'jefe-1'],
        expect.objectContaining({ type: CONVERSATION_MODE_CHANGED }),
      );
    });

    it('no le quita la conversacion a quien ya la atiende', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await web.tomarControl(
        { ...conversation, mode: 'HUMAN_ACTIVE' } as Conversation,
        'jefe-1',
      );
      expect(notifier.escribir).not.toHaveBeenCalled();
      expect(realtime.emitToBosses).not.toHaveBeenCalled();
    });
  });

  describe('pedidosPendientes', () => {
    it('lista lo que la IA entrego por grupo dentro del alcance', async () => {
      empleadas.find.mockResolvedValue([
        { id: MODELO, jefeId: 'jefe-1', jefeSecundarioId: null },
      ]);
      dataSource.query.mockResolvedValueOnce([
        {
          id: CONVERSACION,
          client_id: 'cliente-1',
          client_nombre: 'Carlos',
          employee_id: MODELO,
          nombre_artistico: 'Ana',
          last_message_at: null,
        },
      ]);

      const pedidos = await web.pedidosPendientes({
        id: 'jefe-1',
        rol: 'jefe',
      });

      const [sql, parametros] = dataSource.query.mock.calls[0];
      expect(sql).toContain("c.state->>'motivoDeEntrega' = 'servicio_grupal'");
      expect(sql).toContain('NOT EXISTS');
      expect(parametros[0]).toEqual([MODELO]);
      expect(pedidos).toEqual([
        expect.objectContaining({
          conversationId: CONVERSACION,
          clientNombre: 'Carlos',
          nombreArtistico: 'Ana',
        }),
      ]);
    });

    it('un jefe sin modelos no consulta', async () => {
      await expect(
        web.pedidosPendientes({ id: 'jefe-9', rol: 'jefe' }),
      ).resolves.toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('mensajes', () => {
    it('devuelve la conversacion en orden de lectura con la forma del panel', async () => {
      mensajes.find.mockResolvedValue([
        {
          id: 'm2',
          sender: 'cliente',
          body: '',
          attachment: { type: 'ubicacion', lat: 20.59, lng: -100.39 },
          createdAt: new Date('2026-11-17T03:01:00Z'),
        },
        {
          id: 'm1',
          sender: 'cliente',
          body: '',
          attachment: { type: 'comprobante', url: 'https://r2/x.jpg' },
          createdAt: new Date('2026-11-17T03:00:00Z'),
        },
      ]);

      const lista = await web.mensajes(request);

      expect(lista.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(lista[0]).toEqual(
        expect.objectContaining({
          clienteId: 'cliente-1',
          groupRequestId: 'solicitud-1',
          emisor: 'cliente',
          attachment: { type: 'photo', url: 'https://r2/x.jpg' },
          iaActiva: false,
        }),
      );
      expect(lista[1].attachment).toEqual({
        type: 'location',
        latitude: 20.59,
        longitude: -100.39,
      });
    });
  });

  describe('escribirDelJefe', () => {
    it('quita los emojis y escribe como jefe', async () => {
      const enviado = await web.escribirDelJefe(request, 'Listo \u{1F525} ya');
      expect(notifier.escribir).toHaveBeenCalledWith({
        conversationId: CONVERSACION,
        sender: 'jefe',
        texto: 'Listo ya',
      });
      expect(enviado.emisor).toBe('jefe');
    });

    it('rechaza un mensaje que solo eran emojis', async () => {
      await expect(
        web.escribirDelJefe(request, '\u{1F525}\u{1F525}'),
      ).rejects.toThrow('El mensaje no puede estar vacío');
      expect(notifier.escribir).not.toHaveBeenCalled();
    });
  });

  describe('ultimaUbicacionDelCliente', () => {
    it('lee el ultimo pin del cliente', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          attachment: {
            type: 'ubicacion',
            lat: 20.6,
            lng: -100.4,
            address: ' Centro ',
          },
        },
      ]);
      await expect(
        web.ultimaUbicacionDelCliente(CONVERSACION),
      ).resolves.toEqual({ lat: 20.6, lng: -100.4, address: 'Centro' });
      expect(dataSource.query.mock.calls[0][0]).toContain(
        "attachment->>'type' = 'ubicacion'",
      );
    });

    it('sin pin devuelve null', async () => {
      await expect(
        web.ultimaUbicacionDelCliente(CONVERSACION),
      ).resolves.toBeNull();
    });
  });

  describe('avisos', () => {
    it('la cotizacion sale como aviso con las cuentas activas', async () => {
      await web.avisarCotizacion(request, servicio());
      const { texto, sender } = notifier.escribir.mock.calls[0][0];
      expect(sender).toBe('sistema');
      expect(texto).toContain('Cotización de tu servicio grupal');
      expect(texto).toContain('4152314214309919');
    });

    it('sin conversacion web no escribe nada', async () => {
      await web.avisarCotizacion({ conversationId: null }, servicio());
      await web.avisarSaldo({ conversationId: null }, servicio());
      await web.avisarComprobanteRechazado({ conversationId: null }, 'x');
      expect(notifier.escribir).not.toHaveBeenCalled();
    });

    it('un fallo al escribir no rompe la operacion que lo origina', async () => {
      notifier.escribir.mockRejectedValueOnce(new Error('base caida'));
      await expect(
        web.avisarCotizacion(request, servicio()),
      ).resolves.toBeUndefined();
    });

    it('con saldo pendiente avisa el saldo', async () => {
      await web.avisarSaldo(request, {
        metodoPago: 'transferencia',
        pendingBalance: 1200,
      });
      expect(notifier.escribir.mock.calls[0][0].texto).toContain(
        'Saldo por transferir',
      );
    });

    it('sin saldo solo avisa si el pago se acaba de registrar', async () => {
      await web.avisarSaldo(request, {
        metodoPago: 'transferencia',
        pendingBalance: 0,
      });
      expect(notifier.escribir).not.toHaveBeenCalled();

      await web.avisarSaldo(
        request,
        { metodoPago: 'transferencia', pendingBalance: 0 },
        { pagoRegistrado: true },
      );
      expect(notifier.escribir.mock.calls[0][0].texto).toBe(
        TEXTOS_DEL_GRUPO_WEB.pagoCompleto,
      );
    });

    it('en efectivo no habla de transferencias', async () => {
      await web.avisarSaldo(
        request,
        { metodoPago: 'efectivo', pendingBalance: 900 },
        { pagoRegistrado: true },
      );
      expect(notifier.escribir).not.toHaveBeenCalled();
    });

    it('el motivo del rechazo no deja pasar lo que el cliente no debe leer', async () => {
      await web.avisarComprobanteRechazado(
        request,
        'Lo reviso el jefe de la agencia.',
      );
      const { texto } = notifier.escribir.mock.calls[0][0];
      expect(palabrasVetadasEn(texto)).toEqual([]);
      expect(texto).toContain('Mándame uno nuevo');
    });

    it('el motivo limpio llega al cliente', async () => {
      await web.avisarComprobanteRechazado(request, 'El monto no coincide.');
      expect(notifier.escribir.mock.calls[0][0].texto).toBe(
        TEXTOS_DEL_GRUPO_WEB.comprobanteRechazado('El monto no coincide'),
      );
    });
  });
});
