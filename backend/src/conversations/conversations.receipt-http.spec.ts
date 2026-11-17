import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EVIDENCE_MAX_BYTES } from '../upload/upload.service';
import { ConversationReceiptsService } from './conversation-receipts.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

const CONVERSACION = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/**
 * La ruta de verdad, con Multer y el `ValidationPipe` de la aplicacion. Los
 * guards se sustituyen (su presencia la comprueba `conversations.controller.spec`)
 * y dejan un usuario en la peticion como haria `JwtAuthGuard`.
 */
describe('POST /conversations/:id/receipt (HTTP)', () => {
  let app: INestApplication;
  let receipts: { subirComprobante: jest.Mock };

  const dejarPasar = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest<{ user?: object }>().user = {
        id: 'usuario-1',
        rol: 'cliente',
      };
      return true;
    },
  };

  beforeAll(async () => {
    receipts = { subirComprobante: jest.fn() };
    const modulo = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: {} },
        { provide: ConversationReceiptsService, useValue: receipts },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(dejarPasar)
      .overrideGuard(RolesGuard)
      .useValue(dejarPasar)
      .overrideGuard(CsrfGuard)
      .useValue(dejarPasar)
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

  beforeEach(() => {
    receipts.subirComprobante.mockReset();
    receipts.subirComprobante.mockResolvedValue({
      message: {
        id: 'mensaje-1',
        attachment: { type: 'comprobante', url: 'https://r2/x.jpg' },
      },
      creado: true,
    });
  });

  it('responde 201 con el mensaje y pasa archivo y clientMessageId', async () => {
    const respuesta = await request(servidor())
      .post(`/conversations/${CONVERSACION}/receipt`)
      .field('clientMessageId', '22222222-2222-4222-8222-222222222222')
      .attach('file', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(respuesta.body).toMatchObject({
      id: 'mensaje-1',
      attachment: { type: 'comprobante', url: 'https://r2/x.jpg' },
    });
    const [usuario, id, archivo, dto] = receipts.subirComprobante.mock
      .calls[0] as [string, string, { buffer: Buffer }, object];
    expect(usuario).toBe('usuario-1');
    expect(id).toBe(CONVERSACION);
    expect(archivo.buffer.equals(JPEG)).toBe(true);
    expect(dto).toEqual({
      clientMessageId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('responde 200 al reintento', async () => {
    receipts.subirComprobante.mockResolvedValue({
      message: { id: 'mensaje-1' },
      creado: false,
    });
    await request(servidor())
      .post(`/conversations/${CONVERSACION}/receipt`)
      .attach('file', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' })
      .expect(200);
  });

  it('rechaza con 400 un tipo que no es JPEG, PNG ni WEBP', async () => {
    await request(servidor())
      .post(`/conversations/${CONVERSACION}/receipt`)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'c.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(receipts.subirComprobante).not.toHaveBeenCalled();
  });

  it('corta con 413 un archivo mayor que el limite', async () => {
    await request(servidor())
      .post(`/conversations/${CONVERSACION}/receipt`)
      .attach('file', Buffer.alloc(EVIDENCE_MAX_BYTES + 1), {
        filename: 'c.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
    expect(receipts.subirComprobante).not.toHaveBeenCalled();
  });

  it('rechaza con 400 un clientMessageId que no es uuid', async () => {
    await request(servidor())
      .post(`/conversations/${CONVERSACION}/receipt`)
      .field('clientMessageId', 'no-es-uuid')
      .attach('file', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });

  it('rechaza con 400 un id de conversacion que no es uuid', async () => {
    await request(servidor())
      .post('/conversations/abc/receipt')
      .attach('file', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });
});
