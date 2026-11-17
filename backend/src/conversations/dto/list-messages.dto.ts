import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_MESSAGES_PAGE = 30;
export const MAX_MESSAGES_PAGE = 50;

export class ListMessagesDto {
  @ApiPropertyOptional({
    description:
      'Id del mensaje mas antiguo de la pagina anterior (`nextCursor`); sin el, se empieza por los mas recientes',
  })
  @IsOptional()
  @IsUUID()
  readonly cursor?: string;

  @ApiPropertyOptional({
    description: 'Mensajes por pagina',
    default: DEFAULT_MESSAGES_PAGE,
    maximum: MAX_MESSAGES_PAGE,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGES_PAGE)
  @IsOptional()
  readonly limit?: number;
}
