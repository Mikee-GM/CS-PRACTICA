import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { POST_STATUSES, type PostStatus } from '../entities/post.entity';
import { DEFAULT_POSTS_PAGE, MAX_POSTS_PAGE } from '../posts.service';
import { PostCaptionDto } from './employee-posts.dto';

export const MAX_MOTIVO_RECHAZO_POST = 500;
// El cursor es base64url de `fecha|uuid`: holgado, pero corta basura larga.
const MAX_CURSOR = 200;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListStaffPostsDto {
  @ApiPropertyOptional({
    enum: POST_STATUSES,
    default: 'pendiente',
    description:
      'Estado de los posts. `pendiente` es la cola de revision, del mas antiguo al mas reciente; los demas van del mas reciente al mas antiguo.',
  })
  @IsOptional()
  @IsIn(POST_STATUSES)
  readonly estado?: PostStatus;

  @ApiPropertyOptional({
    description: 'Solo los posts de esa modelo (si esta al alcance)',
  })
  @IsOptional()
  @IsUUID()
  readonly employeeId?: string;

  @ApiPropertyOptional({
    description: 'Opaco: el `nextCursor` de la pagina anterior',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR)
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

/** Post nuevo que un jefe o admin escribe en nombre de una modelo. */
export class CreateStaffPostDto extends PostCaptionDto {
  @ApiProperty({ description: 'Modelo en cuyo perfil se publica' })
  @IsUUID()
  readonly employeeId: string;
}

export class RejectPostDto {
  @ApiProperty({
    minLength: 1,
    maxLength: MAX_MOTIVO_RECHAZO_POST,
    description: 'Lo ve la modelo junto al post rechazado',
  })
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'Indica el motivo del rechazo' })
  @MaxLength(MAX_MOTIVO_RECHAZO_POST, {
    message: `El motivo no puede superar ${MAX_MOTIVO_RECHAZO_POST} caracteres`,
  })
  readonly motivo: string;
}
