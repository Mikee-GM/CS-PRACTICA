import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_POSTS_PAGE, DEFAULT_POSTS_PAGE } from '../posts.service';
import { UPLOAD_MAX_BYTES } from '../../upload/upload.service';
import {
  MAX_CAPTION,
  MAX_MEDIAS,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SEGUNDOS,
} from '../post-estados';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Margen holgado para dimensiones en pixeles: corta basura sin tocar un 8K.
const MAX_DIMENSION = 20_000;

export class ListEmployeePostsDto {
  @ApiPropertyOptional({
    description:
      'Id del ultimo post de la pagina anterior (`nextCursor`); sin el, se empieza por los mas recientes',
  })
  @IsOptional()
  @IsUUID()
  readonly cursor?: string;

  @ApiPropertyOptional({
    description: 'Posts por pagina',
    default: DEFAULT_POSTS_PAGE,
    maximum: MAX_POSTS_PAGE,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_POSTS_PAGE)
  @IsOptional()
  readonly limit?: number;
}

/** Texto de un post; vacio vale, porque la foto puede bastar. */
export class PostCaptionDto {
  @ApiProperty({ maxLength: MAX_CAPTION })
  @Transform(recortar)
  @IsString()
  @MaxLength(MAX_CAPTION, {
    message: `El texto no puede superar ${MAX_CAPTION} caracteres`,
  })
  readonly caption: string;
}

/**
 * Campos de texto del multipart de `POST /employee-portal/posts/:id/media`.
 * Los archivos (`file` y `poster`) no pasan por aqui. Llegan como texto, por
 * eso el `Type(() => Number)`.
 */
export class AddPostMediaDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_DIMENSION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DIMENSION)
  readonly width?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_DIMENSION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DIMENSION)
  readonly height?: number;

  @ApiPropertyOptional({
    description:
      'Duracion del video que mide el navegador; no se verifica en el servidor',
    minimum: 1,
    maximum: MAX_VIDEO_SEGUNDOS * 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SEGUNDOS * 1000, {
    message: `El video no puede durar más de ${MAX_VIDEO_SEGUNDOS} segundos`,
  })
  readonly durationMs?: number;
}

/** Campos de archivo del multipart de media: uno de cada como mucho. */
export const CAMPOS_DE_MEDIA = [
  { name: 'file', maxCount: 1 },
  { name: 'poster', maxCount: 1 },
];

/**
 * Opciones de Multer para la media de un post.
 *
 * Sin `dest` ni `storage`, `@nestjs/platform-express` guarda en memoria, que
 * es lo que necesita `UploadService` (trabaja sobre el buffer); no se importa
 * `memoryStorage` porque el proyecto no instala los tipos de multer.
 *
 * Multer solo admite un `fileSize` comun a todos los campos. Se usa el mayor
 * de los dos topes para que un video se corte mientras llega (413) y no
 * despues de cargarlo entero; el tope exacto de cada tipo lo vuelve a aplicar
 * `uploadPostMedia` segun lo que digan los bytes. Hoy ambos son 20 MB.
 * No hay `fileFilter` por mimetype: el tipo lo deciden los bytes.
 */
export const OPCIONES_DE_SUBIDA_DE_MEDIA = {
  limits: {
    fileSize: Math.max(UPLOAD_MAX_BYTES, MAX_VIDEO_BYTES),
    files: CAMPOS_DE_MEDIA.length,
    fields: 10,
  },
};

export class ReorderPostMediaDto {
  @ApiProperty({
    type: [String],
    description: 'Todas las medias del post, en su nuevo orden',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEDIAS)
  @IsUUID('all', { each: true })
  readonly ids: string[];
}
