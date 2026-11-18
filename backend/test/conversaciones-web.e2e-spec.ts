import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AiMessageService } from '../src/ai/ai-message.service';
import { AuthService } from '../src/auth/auth.service';
import { BookingAiService } from '../src/booking/booking-ai.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RealtimeBus } from '../src/realtime/realtime.bus';
import { RealtimeEventsService } from '../src/realtime/realtime.service';
import { Usuarios } from '../src/users/entities/user.entity';

/**
 * Chat web de punta a punta contra PostgreSQL real: el cliente conversa, la
 * reserva llega al jefe como borrador en revision y el jefe la toma y la
 * acepta. Sustituye a los tres e2e de conversaciones que dependian de Telegram.
 *
 * Todo entra por HTTP con cookie firmada y `x-csrf-token`, como el navegador.
 * Solo se sustituyen los bordes externos: push, redaccion de avisos y el
 * modelo de IA. El turno de reserva, los extractores y la aceptacion del
 * borrador son los reales.
 *
 * Se reutiliza el arranque de `servicio-completo.e2e-spec.ts`.
 */
const IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  boss: '11111111-1111-4111-8111-111111111111',
  otherBoss: '11111111-1111-4111-8111-222222222222',
  employeeUser: '22222222-2222-4222-8222-222222222222',
  otherEmployeeUser: '22222222-2222-4222-8222-333333333333',
  employee: '33333333-3333-4333-8333-333333333333',
  otherEmployee: '33333333-3333-4333-8333-444444444444',
  clientUser: '44444444-4444-4444-8444-555555555555',
  client: '44444444-4444-4444-8444-444444444444',
  otherClientUser: '44444444-4444-4444-8444-777777777777',
  otherClient: '44444444-4444-4444-8444-666666666666',
} as const;

const api = '/api/v1';

// Punto dentro de Queretaro, la unica zona que se atiende.
const PIN_QUERETARO = { lat: 20.5888, lng: -100.3899, address: 'Centro E2E' };
const PIN_QUERETARO_2 = { lat: 20.6, lng: -100.4, address: 'Zona norte E2E' };

const notifications = {
  notificar: jest.fn().mockResolvedValue(undefined),
  notificarJefeServicioPendiente: jest.fn().mockResolvedValue(undefined),
};
const aiMessages = {
  generate: jest.fn((_event: string, _context: unknown, fallback: string) =>
    Promise.resolve(fallback),
  ),
  generateAgencyMessage: jest.fn(
    (_event: string, _context: unknown, fallback: string) =>
      Promise.resolve(fallback),
  ),
};
// El modelo nunca decide nada solo: los datos de la reserva los fijan los
// extractores y el pin, asi que basta con que conteste algo.
const bookingAi = {
  callModel: jest
    .fn()
    .mockResolvedValue('Con gusto, mi cielo. Cuéntame dónde nos vemos.'),
};
const realtime = {
  emitToBoss: jest.fn(),
  emitToBosses: jest.fn(),
  emitToEmployee: jest.fn(),
  emitToDriver: jest.fn(),
  emitToClient: jest.fn(),
  emitToJefes: jest.fn(),
  onLocalDispatch: jest.fn(),
};

type Sesion = { cookies: string[]; csrf: string };

describe('conversaciones web (PostgreSQL)', () => {
  let moduleFixture: TestingModule | undefined;
  let app: INestApplication | undefined;
  let dataSource: DataSource;
  let auth: AuthService;

  beforeAll(async () => {
    // Sin espera de agrupacion ni pausa de "escribiendo": el turno de la IA
    // corre al instante y el test solo espera a que termine.
    process.env.WEB_CHAT_DEBOUNCE_MS = '0';
    process.env.WEB_CHAT_MAX_TYPING_DELAY_MS = '0';

    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationsService)
      .useValue(notifications)
      .overrideProvider(AiMessageService)
      .useValue(aiMessages)
      .overrideProvider(BookingAiService)
      .useValue(bookingAi)
      .overrideProvider(RealtimeBus)
      .useValue({
        onRemoteMessage: jest.fn(),
        publish: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(RealtimeEventsService)
      .useValue(realtime)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser(process.env.COOKIE_SECRET));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    auth = moduleFixture.get(AuthService);
  });

  afterAll(async () => {
    if (app) await app.close();
    else if (moduleFixture) await moduleFixture.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    bookingAi.callModel.mockResolvedValue(
      'Con gusto, mi cielo. Cuéntame dónde nos vemos.',
    );
    await seed();
  });

  async function seed() {
    // Base efimera creada por run-e2e.mjs, igual que en app.e2e-spec.ts.
    await dataSource.query('TRUNCATE TABLE "usuarios", "clientes" CASCADE');
    await dataSource.query(
      `INSERT INTO "usuarios"
        (id, email, password_hash, rol, nombre, activo, disponible, en_jornada)
       VALUES
        ($1, 'admin-e2e@example.com', 'hash', 'admin', 'Admin E2E', true, true, true),
        ($2, 'jefe-e2e@example.com', 'hash', 'jefe', 'Jefe E2E', true, true, true),
        ($3, 'otro-jefe-e2e@example.com', 'hash', 'jefe', 'Otro Jefe E2E', true, true, true),
        ($4, 'empleada-e2e@example.com', 'hash', 'empleada', 'Empleada E2E', true, true, true),
        ($5, 'otra-empleada-e2e@example.com', 'hash', 'empleada', 'Otra Empleada E2E', true, true, true),
        ($6, 'cliente-web@example.com', 'hash', 'cliente', 'Cliente Web', true, true, true),
        ($7, 'otro-cliente-web@example.com', 'hash', 'cliente', 'Otro Cliente', true, true, true)`,
      [
        IDS.admin,
        IDS.boss,
        IDS.otherBoss,
        IDS.employeeUser,
        IDS.otherEmployeeUser,
        IDS.clientUser,
        IDS.otherClientUser,
      ],
    );
    await dataSource.query(
      `INSERT INTO "empleadas"
        (id, usuario_id, nombre_real, nombre_artistico, slug_catalogo,
         precio_base_hora, disponible, catalogo_activo, ubicacion_lat,
         ubicacion_lng, ultima_ubicacion_at, jefe_id)
       VALUES
        ($1, $2, 'Empleada E2E', 'Luna Web', 'luna-web', 200,
         true, true, 20.5888, -100.3899, now(), $3),
        ($4, $5, 'Otra Empleada E2E', 'Sol Web', 'sol-web', 220,
         true, true, 20.6, -100.4, now(), $6)`,
      [
        IDS.employee,
        IDS.employeeUser,
        IDS.boss,
        IDS.otherEmployee,
        IDS.otherEmployeeUser,
        IDS.otherBoss,
      ],
    );
    await dataSource.query(
      `INSERT INTO "clientes" (id, usuario_id, nombre)
       VALUES ($1, $2, 'Cliente Web'), ($3, $4, 'Otro Cliente')`,
      [IDS.client, IDS.clientUser, IDS.otherClient, IDS.otherClientUser],
    );
  }

  // ------------------------------------------------------------- sesion web

  async function accessToken(userId: string): Promise<string> {
    const user = await dataSource
      .getRepository(Usuarios)
      .findOneByOrFail({ id: userId });
    return (await auth.issueSessionFor(user, 'e2e-conversaciones')).accessToken;
  }

  function signedCookie(name: string, value: string): string {
    const secret = process.env.COOKIE_SECRET as string;
    const signature = createHmac('sha256', secret)
      .update(value)
      .digest('base64')
      .replace(/=+$/, '');
    return `${name}=${encodeURIComponent(`s:${value}.${signature}`)}`;
  }

  /** Sesion web completa: cookie firmada mas par CSRF, como el navegador. */
  async function sesion(userId: string): Promise<Sesion> {
    const csrf = `csrf-${userId.slice(-8)}`;
    return {
      cookies: [
        signedCookie('access_token', await accessToken(userId)),
        `csrf_token=${csrf}`,
      ],
      csrf,
    };
  }

  function get(path: string, s: Sesion) {
    return request(app!.getHttpServer())
      .get(`${api}${path}`)
      .set('Cookie', s.cookies);
  }

  function post(path: string, s: Sesion, body?: object) {
    const req = request(app!.getHttpServer())
      .post(`${api}${path}`)
      .set('Cookie', s.cookies)
      .set('x-csrf-token', s.csrf);
    return body ? req.send(body) : req;
  }

  // ---------------------------------------------------------------- ayudas

  /** Reintenta una lectura hasta que se cumpla la condicion o se agote el tiempo. */
  async function esperarA<T>(
    descripcion: string,
    leer: () => Promise<T>,
    cumple: (valor: T) => boolean,
  ): Promise<T> {
    let ultimo: T | undefined;
    for (let intento = 0; intento < 100; intento += 1) {
      ultimo = await leer();
      if (cumple(ultimo)) return ultimo;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `Se agoto la espera de: ${descripcion}. Ultimo valor: ${JSON.stringify(ultimo)}`,
    );
  }

  async function abrirConversacion(
    cliente: Sesion,
    employeeId: string,
  ): Promise<string> {
    const res = await post('/conversations', cliente, { employeeId }).expect(
      201,
    );
    return (res.body as { id: string }).id;
  }

  /**
   * Manda un mensaje del cliente y espera a que el turno de la IA lo atienda:
   * el turno corre fuera de la peticion y deja el cursor de lo atendido en el
   * estado de la conversacion.
   */
  async function escribir(
    cliente: Sesion,
    conversationId: string,
    body: string,
    location?: { lat: number; lng: number; address?: string },
  ): Promise<string> {
    const res = await post(
      `/conversations/${conversationId}/messages`,
      cliente,
      {
        body,
        clientMessageId: randomUUID(),
        ...(location ? { location } : {}),
      },
    ).expect(201);
    const id = (res.body as { id: string }).id;
    await esperarA(
      `que el turno atienda el mensaje ${id}`,
      async () => {
        const filas = await dataSource.query(
          `SELECT state->>'ultimoMensajeAtendidoId' AS cursor
             FROM conversations WHERE id = $1`,
          [conversationId],
        );
        return filas[0]?.cursor ?? null;
      },
      (cursor) => cursor === id,
    );
    return id;
  }

  /**
   * Conversa hasta que la reserva queda completa (horas y pago por texto,
   * ubicacion por pin) y devuelve el id del borrador en revision.
   */
  async function llevarAEnRevision(
    cliente: Sesion,
    conversationId: string,
    datos: {
      texto: string;
      pin: { lat: number; lng: number; address?: string };
    },
  ): Promise<string> {
    await escribir(cliente, conversationId, 'Hola, quiero conocerte');
    await escribir(cliente, conversationId, datos.texto);
    await escribir(cliente, conversationId, 'Aquí estoy', datos.pin);
    const fila = await esperarA(
      'la conversacion en revision con borrador',
      async () =>
        (
          await dataSource.query(
            `SELECT status, booking_session_id FROM conversations WHERE id = $1`,
            [conversationId],
          )
        )[0],
      (c) => c?.status === 'en_revision' && c.booking_session_id !== null,
    );
    return fila.booking_session_id as string;
  }

  async function conversacion(conversationId: string) {
    const [fila] = await dataSource.query(
      `SELECT status, mode, human_owner_id, booking_session_id, service_id
         FROM conversations WHERE id = $1`,
      [conversationId],
    );
    return fila;
  }

  async function mensajesDe(
    conversationId: string,
  ): Promise<Array<{ sender: string; body: string }>> {
    return await dataSource.query(
      `SELECT sender, body FROM messages
        WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC`,
      [conversationId],
    );
  }

  // ---------------------------------------------------------------- pruebas

  it('opera de extremo a extremo una conversacion pre-servicio con ownership', async () => {
    const cliente = await sesion(IDS.clientUser);
    const jefe = await sesion(IDS.boss);
    const otroJefe = await sesion(IDS.otherBoss);
    const admin = await sesion(IDS.admin);

    const conversationId = await abrirConversacion(cliente, IDS.employee);
    // Abrir de nuevo devuelve la misma conversacion, sin duplicarla.
    const reabierta = await post('/conversations', cliente, {
      employeeId: IDS.employee,
    }).expect(200);
    expect((reabierta.body as { id: string }).id).toBe(conversationId);

    const borradorId = await llevarAEnRevision(cliente, conversationId, {
      texto: 'Quiero 2 horas y pago en efectivo',
      pin: PIN_QUERETARO,
    });

    // El modelo contesto al saludo y el cliente lo ve en su historial.
    const historial = await get(
      `/conversations/${conversationId}/messages`,
      cliente,
    ).expect(200);
    const remitentes = (historial.body as { items: Array<{ sender: string }> })
      .items;
    expect(remitentes.map((m) => m.sender)).toEqual(
      expect.arrayContaining(['cliente', 'ia', 'sistema']),
    );

    // El borrador quedo completo y a nombre del cliente y la modelo elegida.
    const [borrador] = await dataSource.query(
      `SELECT status, client_id, intended_employee_id, duration_hours,
              payment_method, service_id
         FROM customer_booking_sessions WHERE id = $1`,
      [borradorId],
    );
    expect(borrador).toMatchObject({
      status: 'READY',
      client_id: IDS.client,
      intended_employee_id: IDS.employee,
      payment_method: 'efectivo',
      service_id: null,
    });
    expect(Number(borrador.duration_hours)).toBe(2);
    expect(await conversacion(conversationId)).toMatchObject({
      status: 'en_revision',
      mode: 'AI_ACTIVE',
      human_owner_id: null,
    });

    // La bandeja del jefe de la modelo la trae marcada para atencion; la del
    // jefe sin relacion no la ve.
    const bandeja = await get('/staff/conversations', jefe).expect(200);
    expect(bandeja.body).toEqual([
      expect.objectContaining({
        id: conversationId,
        status: 'en_revision',
        requiereAtencion: true,
        motivosDeAtencion: expect.arrayContaining(['en_revision']),
        bookingSessionId: borradorId,
        employee: expect.objectContaining({ id: IDS.employee }),
        client: expect.objectContaining({ id: IDS.client }),
      }),
    ]);
    await get('/staff/conversations', otroJefe).expect(200).expect([]);

    // Ownership: el jefe ajeno no lee, no toma, no escribe ni decide.
    await get(
      `/staff/conversations/${conversationId}/messages`,
      otroJefe,
    ).expect(404);
    await post(
      `/staff/conversations/${conversationId}/take-over`,
      otroJefe,
      {},
    ).expect(404);
    await post(`/staff/conversations/${conversationId}/messages`, otroJefe, {
      body: 'Intruso',
      clientMessageId: randomUUID(),
    }).expect(404);
    await post(
      `/staff/conversations/${conversationId}/accept`,
      otroJefe,
    ).expect(404);
    await post(
      `/staff/conversations/${conversationId}/reject`,
      otroJefe,
      {},
    ).expect(404);
    expect(await conversacion(conversationId)).toMatchObject({
      mode: 'AI_ACTIVE',
      human_owner_id: null,
      service_id: null,
    });

    // El jefe asignado la lee y la toma; el cliente recibe el aviso de que
    // continua una persona.
    await get(`/staff/conversations/${conversationId}/messages`, jefe).expect(
      200,
    );
    const toma = await post(
      `/staff/conversations/${conversationId}/take-over`,
      jefe,
      {},
    ).expect(200);
    expect(toma.body).toMatchObject({
      conversationId,
      mode: 'HUMAN_ACTIVE',
      humanOwnerId: IDS.boss,
    });
    expect(await conversacion(conversationId)).toMatchObject({
      mode: 'HUMAN_ACTIVE',
      human_owner_id: IDS.boss,
    });

    // Tomarla otra vez el mismo jefe es idempotente; un admin sin `forzar` no
    // se la quita (409) y con `forzar` si.
    await post(
      `/staff/conversations/${conversationId}/take-over`,
      jefe,
      {},
    ).expect(200);
    await post(
      `/staff/conversations/${conversationId}/take-over`,
      admin,
      {},
    ).expect(409);
    expect((await conversacion(conversationId)).human_owner_id).toBe(IDS.boss);

    // Respuesta humana: idempotente por clientMessageId y visible al cliente.
    const clientMessageId = randomUUID();
    const respuesta = {
      body: 'Respuesta humana pre-servicio E2E',
      clientMessageId,
    };
    await post(
      `/staff/conversations/${conversationId}/messages`,
      jefe,
      respuesta,
    ).expect(201);
    await post(
      `/staff/conversations/${conversationId}/messages`,
      jefe,
      respuesta,
    ).expect(200);
    const [{ total }] = await dataSource.query(
      `SELECT COUNT(*)::int AS total FROM messages
        WHERE conversation_id = $1 AND body = $2`,
      [conversationId, respuesta.body],
    );
    expect(total).toBe(1);

    // Con la conversacion tomada, la IA no contesta lo que escriba el cliente.
    const mensajesAntes = (await mensajesDe(conversationId)).length;
    bookingAi.callModel.mockClear();
    await escribir(cliente, conversationId, 'Gracias, quedo atento');
    expect(bookingAi.callModel).not.toHaveBeenCalled();
    const despues = await mensajesDe(conversationId);
    expect(despues.length).toBe(mensajesAntes + 1);
    expect(despues.map((m) => m.body)).toContain(respuesta.body);

    // El jefe acepta el borrador: nace el servicio, enlazado a la conversacion
    // y asignado al jefe, esperando a la modelo.
    const aceptada = await post(
      `/staff/conversations/${conversationId}/accept`,
      jefe,
    ).expect(200);
    expect(aceptada.body).toMatchObject({
      conversationId,
      status: 'con_servicio',
      bookingSessionId: borradorId,
      idempotent: false,
    });
    const serviceId = (aceptada.body as { serviceId: string }).serviceId;
    const [servicio] = await dataSource.query(
      `SELECT empleada_id, cliente_id, jefe_id, metodo_pago, booking_session_id,
              duracion_pactada_horas, estado_operativo
         FROM servicios WHERE id = $1`,
      [serviceId],
    );
    expect(servicio).toMatchObject({
      empleada_id: IDS.employee,
      cliente_id: IDS.client,
      jefe_id: IDS.boss,
      metodo_pago: 'efectivo',
      booking_session_id: borradorId,
      estado_operativo: 'esperando_aceptacion_empleada',
    });
    expect(Number(servicio.duracion_pactada_horas)).toBe(2);
    expect(await conversacion(conversationId)).toMatchObject({
      status: 'con_servicio',
      service_id: serviceId,
    });
    const [borradorFinal] = await dataSource.query(
      `SELECT status, service_id FROM customer_booking_sessions WHERE id = $1`,
      [borradorId],
    );
    expect(borradorFinal).toEqual({
      status: 'SERVICE_CREATED',
      service_id: serviceId,
    });

    // Aceptar de nuevo es idempotente: no crea otro servicio ni repite avisos.
    const repetida = await post(
      `/staff/conversations/${conversationId}/accept`,
      jefe,
    ).expect(200);
    expect(repetida.body).toMatchObject({ serviceId, idempotent: true });
    const [{ servicios }] = await dataSource.query(
      `SELECT COUNT(*)::int AS servicios FROM servicios
        WHERE booking_session_id = $1`,
      [borradorId],
    );
    expect(servicios).toBe(1);

    // Ya con servicio, rechazar el borrador no procede.
    await post(
      `/staff/conversations/${conversationId}/reject`,
      jefe,
      {},
    ).expect(409);
    expect((await conversacion(conversationId)).status).toBe('con_servicio');
  });

  it('prohibe el acceso cruzado a una conversacion de otra empleada y equipo', async () => {
    const cliente = await sesion(IDS.clientUser);
    const otroCliente = await sesion(IDS.otherClientUser);
    const jefe = await sesion(IDS.boss);
    const otroJefe = await sesion(IDS.otherBoss);
    const admin = await sesion(IDS.admin);
    const empleada = await sesion(IDS.employeeUser);

    // El cliente A conversa con Luna (equipo de `boss`) y el cliente B con Sol
    // (equipo de `otherBoss`).
    const convA = await abrirConversacion(cliente, IDS.employee);
    await escribir(cliente, convA, 'Mensaje del cliente A');
    const convB = await abrirConversacion(otroCliente, IDS.otherEmployee);
    await escribir(otroCliente, convB, 'Mensaje del otro equipo E2E');
    const antes = await mensajesDe(convB);

    // Un cliente no ve ni escribe en la conversacion de otro.
    await get(`/conversations/${convB}`, cliente).expect(404);
    await get(`/conversations/${convB}/messages`, cliente).expect(404);
    await post(`/conversations/${convB}/messages`, cliente, {
      body: 'Cruzado',
      clientMessageId: randomUUID(),
    }).expect(404);
    const propias = await get('/conversations', cliente).expect(200);
    expect((propias.body as Array<{ id: string }>).map((c) => c.id)).toEqual([
      convA,
    ]);

    // El personal no entra por las rutas del cliente, y el cliente ni la
    // empleada entran por las del equipo.
    await get('/conversations', jefe).expect(403);
    await get('/conversations', empleada).expect(403);
    await get('/staff/conversations', cliente).expect(403);
    await get('/staff/conversations', empleada).expect(403);
    await get(`/staff/conversations/${convA}/messages`, empleada).expect(403);
    await post(`/staff/conversations/${convA}/take-over`, empleada, {}).expect(
      403,
    );
    await post(`/staff/conversations/${convA}/accept`, cliente).expect(403);
    await request(app!.getHttpServer())
      .get(`${api}/staff/conversations`)
      .expect(401);

    // Cada jefe ve solo el chat de su equipo; el admin ve los dos.
    const bandejaJefe = await get('/staff/conversations', jefe).expect(200);
    expect(
      (bandejaJefe.body as Array<{ id: string }>).map((c) => c.id),
    ).toEqual([convA]);
    const bandejaOtroJefe = await get('/staff/conversations', otroJefe).expect(
      200,
    );
    expect(bandejaOtroJefe.body).toEqual([
      expect.objectContaining({
        id: convB,
        employee: expect.objectContaining({
          id: IDS.otherEmployee,
          nombreArtistico: 'Sol Web',
        }),
      }),
    ]);
    const bandejaAdmin = await get('/staff/conversations', admin).expect(200);
    expect(
      (bandejaAdmin.body as Array<{ id: string }>).map((c) => c.id).sort(),
    ).toEqual([convA, convB].sort());

    // Un jefe ajeno al equipo no lee, no toma, no escribe ni decide, y la
    // conversacion responde igual que una inexistente.
    await get(`/staff/conversations/${convB}/messages`, jefe).expect(404);
    await post(`/staff/conversations/${convB}/take-over`, jefe, {}).expect(404);
    await post(`/staff/conversations/${convB}/release`, jefe, {}).expect(404);
    await post(`/staff/conversations/${convB}/messages`, jefe, {
      body: 'Cruzado',
      clientMessageId: randomUUID(),
    }).expect(404);
    await post(`/staff/conversations/${convB}/accept`, jefe).expect(404);
    await post(`/staff/conversations/${convB}/reject`, jefe, {}).expect(404);
    await get(`/staff/conversations/${randomUUID()}/messages`, jefe).expect(
      404,
    );

    // Nada cambio en la conversacion ajena.
    expect(await conversacion(convB)).toMatchObject({
      mode: 'AI_ACTIVE',
      human_owner_id: null,
      service_id: null,
    });
    expect(await mensajesDe(convB)).toEqual(antes);

    // El jefe dueno si puede, y el admin tambien.
    await get(`/staff/conversations/${convB}/messages`, otroJefe).expect(200);
    await get(`/staff/conversations/${convB}/messages`, admin).expect(200);
  });

  it('crea dos servicios independientes para el mismo cliente y conserva el historial', async () => {
    const cliente = await sesion(IDS.clientUser);
    const jefe = await sesion(IDS.boss);
    const otroJefe = await sesion(IDS.otherBoss);

    // Un mismo cliente pide a dos modelos de equipos distintos; cada pedido
    // es su propia conversacion y su propio borrador.
    const convLuna = await abrirConversacion(cliente, IDS.employee);
    const convSol = await abrirConversacion(cliente, IDS.otherEmployee);
    expect(convSol).not.toBe(convLuna);

    const borradorLuna = await llevarAEnRevision(cliente, convLuna, {
      texto: 'Quiero 2 horas y pago en efectivo',
      pin: PIN_QUERETARO,
    });
    const borradorSol = await llevarAEnRevision(cliente, convSol, {
      texto: 'Quiero 1 hora y pago con tarjeta',
      pin: PIN_QUERETARO_2,
    });
    expect(borradorSol).not.toBe(borradorLuna);

    // Cada jefe acepta el de su equipo.
    const aceptadaLuna = await post(
      `/staff/conversations/${convLuna}/accept`,
      jefe,
    ).expect(200);
    const aceptadaSol = await post(
      `/staff/conversations/${convSol}/accept`,
      otroJefe,
    ).expect(200);
    const servicioLuna = (aceptadaLuna.body as { serviceId: string }).serviceId;
    const servicioSol = (aceptadaSol.body as { serviceId: string }).serviceId;
    expect(servicioLuna).not.toBe(servicioSol);

    const servicios: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id, cliente_id, empleada_id, jefe_id, metodo_pago,
              booking_session_id, duracion_pactada_horas
         FROM servicios WHERE id IN ($1, $2)`,
      [servicioLuna, servicioSol],
    );
    expect(servicios).toHaveLength(2);
    const dePorId = (id: string) => servicios.find((s) => s.id === id);
    expect(dePorId(servicioLuna)).toMatchObject({
      cliente_id: IDS.client,
      empleada_id: IDS.employee,
      jefe_id: IDS.boss,
      metodo_pago: 'efectivo',
      booking_session_id: borradorLuna,
    });
    expect(Number(dePorId(servicioLuna)!.duracion_pactada_horas)).toBe(2);
    expect(dePorId(servicioSol)).toMatchObject({
      cliente_id: IDS.client,
      empleada_id: IDS.otherEmployee,
      jefe_id: IDS.otherBoss,
      metodo_pago: 'tarjeta',
      booking_session_id: borradorSol,
    });
    expect(Number(dePorId(servicioSol)!.duracion_pactada_horas)).toBe(1);

    // Cada conversacion queda enlazada solo a su servicio.
    expect(await conversacion(convLuna)).toMatchObject({
      status: 'con_servicio',
      service_id: servicioLuna,
      booking_session_id: borradorLuna,
    });
    expect(await conversacion(convSol)).toMatchObject({
      status: 'con_servicio',
      service_id: servicioSol,
      booking_session_id: borradorSol,
    });

    // El historial se conserva: cada chat guarda lo suyo y nada se mezcla.
    const cuerpos = async (id: string) =>
      (await mensajesDe(id)).map((m) => m.body);
    const deLuna = await cuerpos(convLuna);
    const deSol = await cuerpos(convSol);
    expect(deLuna).toContain('Quiero 2 horas y pago en efectivo');
    expect(deLuna).not.toContain('Quiero 1 hora y pago con tarjeta');
    expect(deSol).toContain('Quiero 1 hora y pago con tarjeta');
    expect(deSol).not.toContain('Quiero 2 horas y pago en efectivo');
    expect((await mensajesDe(convLuna)).map((m) => m.sender)).toContain(
      'sistema',
    );

    // El cliente sigue viendo ambos chats completos tras la aceptacion.
    const lista = await get('/conversations', cliente).expect(200);
    expect(
      (lista.body as Array<{ id: string; status: string }>)
        .map((c) => [c.id, c.status])
        .sort(),
    ).toEqual(
      [
        [convLuna, 'con_servicio'],
        [convSol, 'con_servicio'],
      ].sort(),
    );
    const historialLuna = await get(
      `/conversations/${convLuna}/messages`,
      cliente,
    ).expect(200);
    expect(
      (historialLuna.body as { items: Array<{ body: string }> }).items.map(
        (m) => m.body,
      ),
    ).toEqual(expect.arrayContaining(deLuna));

    // Reabrir el chat con una modelo que ya tiene servicio devuelve el mismo,
    // con su historial, en vez de empezar otro.
    const reabierta = await post('/conversations', cliente, {
      employeeId: IDS.employee,
    }).expect(200);
    expect((reabierta.body as { id: string }).id).toBe(convLuna);

    // Aceptar otra vez no crea mas servicios: siguen siendo dos.
    await post(`/staff/conversations/${convLuna}/accept`, jefe).expect(200);
    const [{ total }] = await dataSource.query(
      `SELECT COUNT(*)::int AS total FROM servicios WHERE cliente_id = $1`,
      [IDS.client],
    );
    expect(total).toBe(2);
  });
});
