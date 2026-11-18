import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AiMessageService } from '../src/ai/ai-message.service';
import { AuthService } from '../src/auth/auth.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RealtimeBus } from '../src/realtime/realtime.bus';
import { RealtimeEventsService } from '../src/realtime/realtime.service';
import { Servicios } from '../src/services/entities/service.entity';
import { Usuarios } from '../src/users/entities/user.entity';

/**
 * Recorrido completo de un servicio donde el personal (jefe, empleada y
 * chofer) entra con sesion web y el cliente es una cuenta web. Prueba que el
 * servicio llega al estado terminal solo por HTTP y que los avisos al personal
 * salen por push.
 *
 * Se reutiliza el arranque de `app.e2e-spec.ts`.
 */
const IDS = {
  boss: '11111111-1111-4111-8111-111111111111',
  employeeUser: '22222222-2222-4222-8222-222222222222',
  employee: '33333333-3333-4333-8333-333333333333',
  clientUser: '44444444-4444-4444-8444-555555555555',
  client: '44444444-4444-4444-8444-444444444444',
  driverUser: '55555555-5555-4555-8555-555555555555',
  driver: '66666666-6666-4666-8666-666666666666',
  service: '77777777-7777-4777-8777-777777777777',
} as const;

const api = '/api/v1';

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
const realtime = {
  emitToBoss: jest.fn(),
  emitToBosses: jest.fn(),
  emitToEmployee: jest.fn(),
  emitToDriver: jest.fn(),
  emitToClient: jest.fn(),
  emitToJefes: jest.fn(),
  onLocalDispatch: jest.fn(),
};

describe('servicio completo (PostgreSQL)', () => {
  let moduleFixture: TestingModule | undefined;
  let app: INestApplication | undefined;
  let dataSource: DataSource;
  let auth: AuthService;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationsService)
      .useValue(notifications)
      .overrideProvider(AiMessageService)
      .useValue(aiMessages)
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
    await seed();
  });

  async function seed() {
    // Base efimera creada por run-e2e.mjs, igual que en app.e2e-spec.ts.
    await dataSource.query('TRUNCATE TABLE "usuarios", "clientes" CASCADE');
    await dataSource.query(
      `INSERT INTO "usuarios"
        (id, email, password_hash, rol, nombre, activo, disponible, en_jornada)
       VALUES
        ($1, 'jefe-e2e@example.com', 'hash', 'jefe', 'Jefe E2E', true, true, true),
        ($2, 'empleada-e2e@example.com', 'hash', 'empleada', 'Empleada E2E', true, true, true),
        ($3, 'chofer-e2e@example.com', 'hash', 'chofer', 'Chofer E2E', true, true, true),
        ($4, 'cliente-web@example.com', 'hash', 'cliente', 'Cliente Web', true, true, true)`,
      [IDS.boss, IDS.employeeUser, IDS.driverUser, IDS.clientUser],
    );
    await dataSource.query(
      `INSERT INTO "empleadas"
        (id, usuario_id, nombre_real, nombre_artistico, slug_catalogo,
         precio_base_hora, disponible, catalogo_activo, ubicacion_lat,
         ubicacion_lng, ultima_ubicacion_at, jefe_id)
       VALUES
        ($1, $2, 'Empleada E2E', 'Luna Web', 'luna-web', 200,
         true, true, 4.7109000, -74.0721000, now(), $3)`,
      [IDS.employee, IDS.employeeUser, IDS.boss],
    );
    await dataSource.query(
      `INSERT INTO "clientes" (id, usuario_id, nombre_telegram)
       VALUES ($1, $2, 'Cliente Web')`,
      [IDS.client, IDS.clientUser],
    );
    await dataSource.query(
      `INSERT INTO "choferes"
        (id, usuario_id, nombre, telefono, disponible, ubicacion_lat,
         ubicacion_lng, ultima_ubicacion_at, vehiculo_marca,
         vehiculo_modelo, vehiculo_color, vehiculo_placa)
       VALUES ($1, $2, 'Chofer E2E', '3000000000', true, 4.7110000,
               -74.0720000, now(), 'Nissan', 'Versa', 'Negro',
               'E2E-123')`,
      [IDS.driver, IDS.driverUser],
    );
    await dataSource.query(
      `INSERT INTO "servicios"
        (id, empleada_id, cliente_id, jefe_id, metodo_pago,
         duracion_pactada_horas, ubicacion_cliente_lat,
         ubicacion_cliente_lng, precio_base_hora_pactado, estado,
         estado_operativo, location_name_snapshot, location_address_snapshot)
       VALUES ($1, $2, $3, $4, 'efectivo', 1, 4.7115000, -74.0715000,
               200, 'pendiente', 'preparacion', 'Lugar E2E', 'Direccion E2E')`,
      [IDS.service, IDS.employee, IDS.client, IDS.boss],
    );
  }

  async function operationalState(): Promise<string> {
    const row = await dataSource
      .getRepository(Servicios)
      .findOneByOrFail({ id: IDS.service });
    return row.operationalState;
  }

  async function accessToken(userId: string): Promise<string> {
    const user = await dataSource
      .getRepository(Usuarios)
      .findOneByOrFail({ id: userId });
    return (await auth.issueSessionFor(user, 'e2e-servicio-completo'))
      .accessToken;
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
  async function sesion(userId: string): Promise<{
    cookies: string[];
    csrf: string;
  }> {
    const csrf = `csrf-${userId.slice(0, 8)}`;
    return {
      cookies: [
        signedCookie('access_token', await accessToken(userId)),
        `csrf_token=${csrf}`,
      ],
      csrf,
    };
  }

  function post(
    path: string,
    s: { cookies: string[]; csrf: string },
    body?: object,
  ) {
    const req = request(app!.getHttpServer())
      .post(`${api}${path}`)
      .set('Cookie', s.cookies)
      .set('x-csrf-token', s.csrf);
    return body ? req.send(body) : req;
  }

  async function tripId(tipo: 'ida' | 'regreso'): Promise<string> {
    const [row] = (await dataSource.query(
      `SELECT id FROM viajes WHERE servicio_id = $1 AND tipo = $2`,
      [IDS.service, tipo],
    )) as Array<{ id: string }>;
    return row.id;
  }

  it('lleva el servicio al estado terminal solo por HTTP', async () => {
    const jefe = await sesion(IDS.boss);
    const empleada = await sesion(IDS.employeeUser);
    const chofer = await sesion(IDS.driverUser);

    await post(`/services/${IDS.service}/aceptar`, jefe, {
      transportType: 'chofer',
    }).expect(201);
    expect(await operationalState()).toBe('esperando_aceptacion_empleada');

    await post(
      `/employee-portal/services/${IDS.service}/accept`,
      empleada,
    ).expect(200);
    expect(await operationalState()).toBe('esperando_transporte_ida');

    await post(`/services/${IDS.service}/internal-transport`, jefe).expect(201);
    const ida = await tripId('ida');
    await post(`/driver-portal/trips/${ida}/accept`, chofer).expect(200);
    expect(await operationalState()).toBe('transporte_ida_asignado');
    await post(`/driver-portal/trips/${ida}/arrived`, chofer).expect(200);
    await post(`/driver-portal/trips/${ida}/picked-up`, chofer).expect(200);
    expect(await operationalState()).toBe('empleada_en_camino');
    await post(`/driver-portal/trips/${ida}/finished`, chofer).expect(200);
    expect(await operationalState()).toBe('empleada_llego');

    await post(
      `/employee-portal/services/${IDS.service}/start`,
      empleada,
    ).expect(200);
    expect(await operationalState()).toBe('en_curso');
    await post(
      `/employee-portal/services/${IDS.service}/finish`,
      empleada,
    ).expect(200);
    expect(await operationalState()).toBe('preparando_regreso');

    await post(`/services/${IDS.service}/internal-transport`, jefe).expect(201);
    const regreso = await tripId('regreso');
    await post(`/driver-portal/trips/${regreso}/accept`, chofer).expect(200);
    await post(`/driver-portal/trips/${regreso}/arrived`, chofer).expect(200);
    await post(`/driver-portal/trips/${regreso}/picked-up`, chofer).expect(200);
    expect(await operationalState()).toBe('empleada_de_regreso');
    await post(`/driver-portal/trips/${regreso}/finished`, chofer).expect(200);
    expect(await operationalState()).toBe('finalizado');

    // El aviso al personal sale por push, que es lo que reemplaza al chat.
    expect(notifications.notificar).toHaveBeenCalled();
  });

  describe('cierre de las vias de acceso por token', () => {
    it('no acepta el jwt por query ni sin cookie ni Bearer', async () => {
      const token = await accessToken(IDS.employeeUser);
      await request(app!.getHttpServer())
        .get(`${api}/employee-portal/me`)
        .query({ token })
        .expect(401);
    });

    it('no expone el canje de pases ni de token de portal', async () => {
      await request(app!.getHttpServer())
        .post(`${api}/auth/portal-session`)
        .send({ token: 'x' })
        .expect(404);
      await request(app!.getHttpServer())
        .post(`${api}/auth/panel-access`)
        .send({ token: 'x' })
        .expect(404);
    });

    it('niega el portal de la empleada a una sesion de jefe', async () => {
      const jefe = await sesion(IDS.boss);
      await request(app!.getHttpServer())
        .get(`${api}/employee-portal/me`)
        .set('Cookie', jefe.cookies)
        .expect(403);
    });
  });
});
