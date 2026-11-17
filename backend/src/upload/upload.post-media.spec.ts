import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { MAX_VIDEO_BYTES } from '../posts/post-estados';
import {
  UPLOAD_MAX_BYTES,
  UploadService,
  sniffImageContentType,
  sniffVideoContentType,
} from './upload.service';

jest.mock('@aws-sdk/client-s3', () => {
  const actual =
    jest.requireActual<Record<string, unknown>>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  };
});

const EMPLOYEE_ID = '2b0c6f7e-5d2a-4c1e-9f3b-1a2b3c4d5e6f';

/** Caja `ftyp` minima: marca principal, version y marcas compatibles. */
function ftyp(major: string, compatible: string[] = []): Buffer {
  const size = 16 + compatible.length * 4;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(size, 0);
  header.write('ftyp', 4, 'ascii');
  header.write(major, 8, 'ascii');
  return Buffer.concat([
    header,
    Buffer.from(compatible.join(''), 'ascii'),
    Buffer.from('mdat-de-relleno'),
  ]);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 '),
]);
const MP4 = ftyp('isom', ['isom', 'iso2', 'avc1', 'mp41']);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const MOV_HEVC = ftyp('qt  ', ['qt  ']);
const MOV_COMPATIBLE = ftyp('qt  ', ['qt  ', 'mp42']);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
// Lo que llega cuando alguien renombra un texto a `.png`.
const FAKE_PNG = Buffer.from('esto no es un png aunque se llame foto.png');

describe('deteccion del tipo por bytes', () => {
  it('reconoce MP4 por su ftyp y WebM por su cabecera EBML', () => {
    expect(sniffVideoContentType(MP4)).toBe('video/mp4');
    expect(sniffVideoContentType(ftyp('mp42'))).toBe('video/mp4');
    expect(sniffVideoContentType(ftyp('M4V '))).toBe('video/mp4');
    expect(sniffVideoContentType(WEBM)).toBe('video/webm');
  });

  it('admite un MOV solo si declara una marca compatible con MP4', () => {
    expect(sniffVideoContentType(MOV_COMPATIBLE)).toBe('video/mp4');
    expect(sniffVideoContentType(MOV_HEVC)).toBeNull();
  });

  it('rechaza marcas desconocidas, imagenes y texto', () => {
    expect(sniffVideoContentType(ftyp('heic', ['mif1']))).toBeNull();
    expect(sniffVideoContentType(JPEG)).toBeNull();
    expect(sniffVideoContentType(HTML)).toBeNull();
    expect(sniffVideoContentType(Buffer.alloc(0))).toBeNull();
  });

  it('no lee las marcas compatibles mas alla del buffer', () => {
    const truncated = MOV_COMPATIBLE.subarray(0, 20);
    expect(sniffVideoContentType(truncated)).toBeNull();
  });

  it('exporta la deteccion de imagenes existente', () => {
    expect(sniffImageContentType(PNG)).toBe('image/png');
    expect(sniffImageContentType(MP4)).toBeNull();
  });
});

describe('UploadService.uploadPostMedia', () => {
  const send = jest.fn().mockResolvedValue({});
  const values: Record<string, string> = {
    R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'access',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'bucket',
    R2_PUBLIC_URL: 'https://media.example.com',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  let service: UploadService;

  beforeEach(() => {
    jest.clearAllMocks();
    (S3Client as unknown as jest.Mock).mockImplementation(() => ({ send }));
    service = new UploadService(config);
  });

  const lastCommand = () => (send.mock.calls as PutObjectCommand[][])[0][0];

  it.each([
    ['imagen', JPEG, 'image/jpeg', 'jpg'],
    ['imagen', PNG, 'image/png', 'png'],
    ['imagen', WEBP, 'image/webp', 'webp'],
    ['video', MP4, 'video/mp4', 'mp4'],
    ['video', WEBM, 'video/webm', 'webm'],
  ] as const)(
    'acepta %s con tipo %s',
    async (kind, buffer, mimeType, extension) => {
      const result = await service.uploadPostMedia({
        buffer,
        employeeId: EMPLOYEE_ID,
        kind,
      });

      expect(result.url).toMatch(
        new RegExp(
          `^https://media\\.example\\.com/posts/${EMPLOYEE_ID}/[0-9a-f-]{36}\\.${extension}$`,
        ),
      );
      expect(result).toEqual({
        url: result.url,
        kind,
        mimeType,
        bytes: buffer.length,
      });
      expect(lastCommand().input).toEqual(
        expect.objectContaining({
          Bucket: 'bucket',
          Key: result.url.replace('https://media.example.com/', ''),
          ContentType: mimeType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    },
  );

  it.each([
    ['un HTML como imagen', 'imagen', HTML],
    ['un HTML como video', 'video', HTML],
    ['un .png falso', 'imagen', FAKE_PNG],
    ['un MOV HEVC', 'video', MOV_HEVC],
    ['una imagen pedida como video', 'video', JPEG],
    ['un video pedido como imagen', 'imagen', MP4],
    ['un archivo vacio', 'imagen', Buffer.alloc(0)],
  ] as const)('rechaza %s sin subir nada', async (_caso, kind, buffer) => {
    await expect(
      service.uploadPostMedia({ buffer, employeeId: EMPLOYEE_ID, kind }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('rechaza un video por encima de su tope', async () => {
    const buffer = Buffer.concat([MP4, Buffer.alloc(MAX_VIDEO_BYTES)]);
    await expect(
      service.uploadPostMedia({
        buffer,
        employeeId: EMPLOYEE_ID,
        kind: 'video',
      }),
    ).rejects.toThrow('20 MB');
    expect(send).not.toHaveBeenCalled();
  });

  it('rechaza una imagen por encima del tope de imagenes', async () => {
    const buffer = Buffer.concat([JPEG, Buffer.alloc(UPLOAD_MAX_BYTES)]);
    await expect(
      service.uploadPostMedia({
        buffer,
        employeeId: EMPLOYEE_ID,
        kind: 'imagen',
      }),
    ).rejects.toThrow('MB');
    expect(send).not.toHaveBeenCalled();
  });

  it('no deja meter rutas en el id de la modelo', async () => {
    await expect(
      service.uploadPostMedia({
        buffer: JPEG,
        employeeId: '../modelos',
        kind: 'imagen',
      }),
    ).rejects.toThrow('no válido');
    expect(send).not.toHaveBeenCalled();
  });

  it('sube el poster como imagen en la carpeta del post', async () => {
    const result = await service.uploadPostPoster({
      buffer: WEBP,
      employeeId: EMPLOYEE_ID,
    });
    expect(result.kind).toBe('imagen');
    expect(result.url).toContain(`/posts/${EMPLOYEE_ID}/`);
    await expect(
      service.uploadPostPoster({ buffer: MP4, employeeId: EMPLOYEE_ID }),
    ).rejects.toThrow('JPEG, PNG o WEBP');
  });

  it('traduce un fallo de R2 a un error controlado', async () => {
    send.mockRejectedValueOnce(new Error('timeout interno'));
    await expect(
      service.uploadPostMedia({
        buffer: JPEG,
        employeeId: EMPLOYEE_ID,
        kind: 'imagen',
      }),
    ).rejects.toThrow('No fue posible almacenar el archivo en la nube');
  });
});
