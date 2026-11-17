import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PortalAuthGuard } from '../auth/guards/portal-auth.guard';
import { EmployeesService } from '../employees/employees.service';
import { EmployeePostsController } from './employee-posts.controller';
import { MAX_VIDEO_BYTES } from './post-estados';
import { PostsService } from './posts.service';

const POST = '33333333-3333-4333-8333-333333333333';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.alloc(12),
]);

/**
 * La subida de media de verdad, con Multer y el `ValidationPipe` de la
 * aplicacion. `PortalAuthGuard` se sustituye (su presencia la comprueba
 * `employee-posts.controller.spec`) y deja el usuario del portal en la
 * peticion como haria el guard real.
 */
describe('POST /employee-portal/posts/:id/media (HTTP)', () => {
  let app: INestApplication;
  const posts = { agregarMedia: jest.fn(), reordenarMedia: jest.fn() };
  const employees = { findByUserId: jest.fn() };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [EmployeePostsController],
      providers: [
        { provide: PostsService, useValue: posts },
        { provide: EmployeesService, useValue: employees },
      ],
    })
      .overrideGuard(PortalAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx
            .switchToHttp()
            .getRequest<{ portalUserId?: string }>().portalUserId = 'usuario-1';
          return true;
        },
      })
      .compile();
    app = modulo.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const ruta = `/employee-portal/posts/${POST}/media`;

  beforeEach(() => {
    posts.agregarMedia.mockReset().mockResolvedValue({ id: POST, media: [] });
    posts.reordenarMedia.mockReset().mockResolvedValue({ id: POST });
    employees.findByUserId.mockReset().mockResolvedValue({ id: 'empleada-1' });
  });

  it('responde 201 y pasa archivo, portada y medidas como numeros', async () => {
    await request(servidor())
      .post(ruta)
      .field('width', '1080')
      .field('height', '1920')
      .field('durationMs', '15000')
      // El mimetype declarado no cuenta: aqui miente a proposito.
      .attach('file', MP4, { filename: 'v.mp4', contentType: 'text/plain' })
      .attach('poster', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(employees.findByUserId).toHaveBeenCalledWith('usuario-1');
    const [postId, employeeId, media] = posts.agregarMedia.mock.calls[0] as [
      string,
      string,
      {
        buffer: Buffer;
        posterBuffer?: Buffer;
        width?: number;
        height?: number;
        durationMs?: number;
      },
    ];
    expect([postId, employeeId]).toEqual([POST, 'empleada-1']);
    expect(media.buffer.equals(MP4)).toBe(true);
    expect(media.posterBuffer?.equals(JPEG)).toBe(true);
    expect([media.width, media.height, media.durationMs]).toEqual([
      1080, 1920, 15000,
    ]);
  });

  it('responde 400 sin el campo file', async () => {
    await request(servidor())
      .post(ruta)
      .attach('poster', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(posts.agregarMedia).not.toHaveBeenCalled();
  });

  it('responde 400 con dos archivos en file', async () => {
    await request(servidor())
      .post(ruta)
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('file', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(posts.agregarMedia).not.toHaveBeenCalled();
  });

  it('responde 400 a una duracion mayor de 30 s o a un campo desconocido', async () => {
    await request(servidor())
      .post(ruta)
      .field('durationMs', '30001')
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await request(servidor())
      .post(ruta)
      .field('kind', 'video')
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(posts.agregarMedia).not.toHaveBeenCalled();
  });

  it('corta con 413 un archivo mayor que el limite', async () => {
    await request(servidor())
      .post(ruta)
      .attach('file', Buffer.alloc(MAX_VIDEO_BYTES + 1), {
        filename: 'v.mp4',
        contentType: 'video/mp4',
      })
      .expect(413);
    expect(posts.agregarMedia).not.toHaveBeenCalled();
  });

  it('responde 400 a un id que no es uuid', async () => {
    await request(servidor())
      .post('/employee-portal/posts/abc/media')
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });

  it('responde 404 a una cuenta que no es de empleada', async () => {
    employees.findByUserId.mockRejectedValue(
      new NotFoundException('Perfil de empleada no encontrado'),
    );
    await request(servidor())
      .post(ruta)
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(404);
    expect(posts.agregarMedia).not.toHaveBeenCalled();
  });

  it('valida que el orden sea una lista de uuid', async () => {
    await request(servidor())
      .put(`/employee-portal/posts/${POST}/media/order`)
      .send({ ids: ['no-es-uuid'] })
      .expect(400);
    await request(servidor())
      .put(`/employee-portal/posts/${POST}/media/order`)
      .send({ ids: [POST] })
      .expect(200);
    expect(posts.reordenarMedia).toHaveBeenCalledWith(POST, 'empleada-1', [
      POST,
    ]);
  });
});
