import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_FEED_PAGE = 10;
export const MAX_FEED_PAGE = 20;

export class ListFeedDto {
  @ApiPropertyOptional({
    description:
      'Cursor opaco de la pagina anterior (`nextCursor`); sin el, se empieza por los posts mas recientes',
  })
  @IsOptional()
  @IsString()
  // Un cursor valido ocupa unos 90 caracteres; el tope solo evita decodificar
  // cadenas arbitrariamente largas antes de rechazarlas.
  @MaxLength(200)
  readonly cursor?: string;

  @ApiPropertyOptional({
    description: 'Posts por pagina',
    default: DEFAULT_FEED_PAGE,
    maximum: MAX_FEED_PAGE,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FEED_PAGE)
  @IsOptional()
  readonly limit?: number;
}
