import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { describeError } from '../common/errors/error-message';
import type { PostMediaKind } from '../posts/entities/post-media.entity';
import { MAX_VIDEO_BYTES } from '../posts/post-estados';

// Exportado para que las rutas que reciben evidencia corten la subida en
// Multer con el mismo tope, antes de cargarla entera en memoria.
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Lo unico que el servicio necesita del fichero que entrega Multer. Se declara
 * aqui para no depender de @types/multer, que el proyecto no instala.
 */
export type UploadedFilePayload = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
};

/**
 * Tope de las subidas del panel. Se aplica tambien en el FileInterceptor.
 *
 * Veinte megas y no diez: una captura de pantalla de un movil reciente pasa de
 * los catorce, y quien sube la captura de su viaje se encontraba con que el
 * servidor la rechazaba. El cliente comprime antes de mandar
 * (`lib/comprimir-imagen.ts`), asi que lo normal es que llegue alrededor de un
 * mega; este numero es el margen para lo que entre sin pasar por ahi --el bot
 * de Telegram, una version vieja de la aplicacion instalada-- no el tamaño que
 * se espera.
 */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Unicos hosts desde los que se descarga evidencia. `uploadEvidenceFromUrl`
 * hace una peticion saliente desde el backend, asi que sin lista blanca seria
 * un SSRF hacia la red interna o al endpoint de metadatos del proveedor.
 */
const EVIDENCE_SOURCE_HOSTS = new Set(['api.telegram.org']);

/** Timeout de la descarga de evidencia, para no colgar el handler. */
const EVIDENCE_FETCH_TIMEOUT_MS = 15_000;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function sniffImageContentType(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const VIDEO_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Marcas ISO BMFF que los navegadores reproducen como MP4. Se cotejan contra
 * la marca principal del `ftyp` y, en un MOV, contra las compatibles.
 */
const MP4_BRANDS = new Set(['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'M4V ']);

/**
 * Tipo real de un video por sus primeros bytes, o `null` si no es MP4 ni
 * WebM. Un MOV (`qt  `) solo pasa si declara una marca compatible con MP4: el
 * que graba un iPhone en HEVC lleva solo `qt  ` y la mayoria de navegadores no
 * lo reproduce, asi que se rechaza aunque el navegador lo anuncie como video.
 */
export function sniffVideoContentType(buffer: Buffer): string | null {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'video/webm';
  }
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return null;
  }
  const majorBrand = buffer.toString('ascii', 8, 12);
  if (MP4_BRANDS.has(majorBrand)) return 'video/mp4';
  if (majorBrand !== 'qt  ') return null;

  // Caja ftyp: tamaño (4) + 'ftyp' (4) + marca (4) + version (4) y despues
  // las marcas compatibles de 4 en 4 hasta el final de la caja.
  const boxEnd = Math.min(buffer.readUInt32BE(0), buffer.length);
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    if (MP4_BRANDS.has(buffer.toString('ascii', offset, offset + 4))) {
      return 'video/mp4';
    }
  }
  return null;
}

/** Resultado de subir una media de post (o el poster de un video). */
export type PostMediaUpload = {
  url: string;
  kind: PostMediaKind;
  mimeType: string;
  bytes: number;
};

// El id va en la ruta del objeto; sin esta forma fija podria colar `../`.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private s3Client: S3Client;
  private bucketName: string;
  private publicUrl: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: this.configService.getOrThrow<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'R2_SECRET_ACCESS_KEY',
        ),
      },
    });
    this.bucketName = this.configService.getOrThrow<string>('R2_BUCKET_NAME');
    this.publicUrl = this.configService.getOrThrow<string>('R2_PUBLIC_URL');
  }

  /**
   * El bucket es publico, asi que el `Content-Type` no puede venir del cliente:
   * subir un HTML declarado como `text/html` daria XSS almacenado bajo el
   * dominio de confianza. Se deduce del contenido real del fichero y se rechaza
   * lo que no sea una imagen conocida.
   */
  async uploadFile(file: UploadedFilePayload): Promise<{ url: string }> {
    const contentType = this.assertImage(file);
    const extension = IMAGE_EXTENSIONS[contentType];
    const key = `modelos/${Date.now()}-${randomUUID()}.${extension}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: contentType,
        }),
      );

      return { url: `${this.publicUrl}/${key}` };
    } catch (error) {
      this.logger.error(`Error subiendo archivo a R2: ${describeError(error)}`);
      throw new InternalServerErrorException('Error al subir el archivo a R2');
    }
  }

  /**
   * Valida tamaño y formato real. Se mira el contenido con `sniffImageContentType`
   * y solo se acepta el mimetype declarado si coincide con lo que dicen los
   * bytes; asi un `.png` renombrado o un HTML disfrazado se rechazan igual.
   */
  private assertImage(file: UploadedFilePayload): string {
    if (!file.buffer?.length) {
      throw new BadRequestException('El archivo recibido está vacío');
    }
    if (file.buffer.length > UPLOAD_MAX_BYTES) {
      throw new BadRequestException(
        `El archivo supera el límite de ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB`,
      );
    }
    const sniffed = sniffImageContentType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(
        'Solo se aceptan imágenes JPEG, PNG o WEBP',
      );
    }
    return sniffed;
  }

  /**
   * Sube una foto o un video de un post a `posts/<employeeId>/<uuid>.<ext>`.
   *
   * El tipo sale solo de los bytes; no se acepta el mimetype del navegador ni
   * siquiera como pista, porque lo aprobado se sirve desde el bucket publico.
   * Si los bytes no corresponden al `kind` pedido se rechaza. La key lleva un
   * uuid y nunca se reescribe, por eso el objeto se marca inmutable y la CDN
   * lo cachea un año. Para borrar, `deleteFile(url)`.
   */
  async uploadPostMedia(input: {
    buffer: Buffer;
    employeeId: string;
    kind: PostMediaKind;
  }): Promise<PostMediaUpload> {
    if (!input.buffer?.length) {
      throw new BadRequestException('El archivo recibido está vacío');
    }
    const isVideo = input.kind === 'video';
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : UPLOAD_MAX_BYTES;
    if (input.buffer.length > maxBytes) {
      throw new BadRequestException(
        `El archivo supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB`,
      );
    }

    const mimeType = isVideo
      ? sniffVideoContentType(input.buffer)
      : sniffImageContentType(input.buffer);
    if (!mimeType) {
      throw new BadRequestException(
        isVideo
          ? 'Solo se aceptan videos MP4 o WebM'
          : 'Solo se aceptan imágenes JPEG, PNG o WEBP',
      );
    }
    const extension = isVideo
      ? VIDEO_EXTENSIONS[mimeType]
      : IMAGE_EXTENSIONS[mimeType];
    const key = `posts/${this.assertEmployeeId(input.employeeId)}/${randomUUID()}.${extension}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: input.buffer,
          ContentType: mimeType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Error subiendo media de post a R2: ${describeError(error)}`,
      );
      throw new InternalServerErrorException(
        'No fue posible almacenar el archivo en la nube',
      );
    }
    return {
      url: `${this.publicUrl}/${key}`,
      kind: input.kind,
      mimeType,
      bytes: input.buffer.length,
    };
  }

  /**
   * Poster de un video: el fotograma que genera el navegador. Es una imagen
   * mas, con las mismas reglas y la misma carpeta que la media del post.
   */
  uploadPostPoster(input: {
    buffer: Buffer;
    employeeId: string;
  }): Promise<PostMediaUpload> {
    return this.uploadPostMedia({ ...input, kind: 'imagen' });
  }

  private assertEmployeeId(employeeId: string): string {
    if (!UUID_PATTERN.test(employeeId)) {
      throw new BadRequestException('Identificador de modelo no válido');
    }
    return employeeId.toLowerCase();
  }

  async uploadEvidence(input: {
    buffer: Buffer;
    contentType: string;
    folder: 'uber' | 'transferencias';
    scopeId?: string;
  }): Promise<{ url: string; key: string }> {
    if (!input.buffer.length || input.buffer.length > EVIDENCE_MAX_BYTES) {
      throw new BadRequestException(
        'La evidencia recibida está vacía o supera el límite permitido',
      );
    }

    let contentType = input.contentType.split(';')[0].trim().toLowerCase();
    let extension = IMAGE_EXTENSIONS[contentType];
    if (!extension) {
      const sniffed = sniffImageContentType(input.buffer);
      if (sniffed) {
        contentType = sniffed;
        extension = IMAGE_EXTENSIONS[sniffed];
      }
    }
    if (!extension) {
      throw new BadRequestException(
        'La evidencia recibida no tiene un formato de imagen compatible',
      );
    }

    const scope = input.scopeId ? `/${input.scopeId}` : '';
    const key = `evidencias/${input.folder}${scope}/${randomUUID()}.${extension}`;
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: input.buffer,
          ContentType: contentType,
        }),
      );
      return { key, url: `${this.publicUrl}/${key}` };
    } catch (error) {
      this.logger.error(
        `Error subiendo evidencia a R2: ${describeError(error)}`,
      );
      throw new InternalServerErrorException(
        'No fue posible almacenar la evidencia en la nube',
      );
    }
  }

  async uploadEvidenceFromUrl(input: {
    sourceUrl: string;
    folder: 'uber' | 'transferencias';
    scopeId?: string;
  }): Promise<{ url: string; key: string }> {
    this.assertAllowedSource(input.sourceUrl);

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      EVIDENCE_FETCH_TIMEOUT_MS,
    );
    try {
      response = await fetch(input.sourceUrl, { signal: controller.signal });
    } catch (error) {
      this.logger.error(`Error descargando evidencia: ${describeError(error)}`);
      throw new InternalServerErrorException(
        'No fue posible descargar la evidencia recibida',
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new InternalServerErrorException(
        'No fue posible descargar la evidencia recibida',
      );
    }

    // El Content-Length puede mentir o faltar, asi que el tope real lo impone
    // uploadEvidence sobre el buffer ya materializado; esto solo corta pronto
    // lo que ya se anuncia como demasiado grande.
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > EVIDENCE_MAX_BYTES) {
      throw new BadRequestException(
        'La evidencia recibida supera el límite permitido',
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return this.uploadEvidence({
      buffer,
      contentType: response.headers.get('content-type') ?? '',
      folder: input.folder,
      scopeId: input.scopeId,
    });
  }

  /**
   * Solo se descarga de los hosts de la lista blanca y siempre por https. Sin
   * esto, cualquier ruta que llegue a alimentar `sourceUrl` convierte al
   * backend en un proxy hacia su propia red interna.
   */
  private assertAllowedSource(sourceUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new BadRequestException('El origen de la evidencia no es válido');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException(
        'El origen de la evidencia debe usar https',
      );
    }
    if (!EVIDENCE_SOURCE_HOSTS.has(parsed.hostname)) {
      throw new BadRequestException(
        'El origen de la evidencia no está autorizado',
      );
    }
  }

  async deleteFile(url: string): Promise<{ success: boolean }> {
    try {
      if (!url.startsWith(this.publicUrl)) {
        return { success: false };
      }
      const key = url.replace(`${this.publicUrl}/`, '');

      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error eliminando archivo de R2: ${describeError(error)}`,
      );
      throw new InternalServerErrorException(
        'Error al eliminar el archivo de R2',
      );
    }
  }
}
