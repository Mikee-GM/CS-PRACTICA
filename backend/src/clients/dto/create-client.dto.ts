import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClientDto {
  @ApiPropertyOptional({
    description: 'Nombre visible del cliente',
    example: 'Juan',
    maxLength: 255,
  })
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres' })
  @IsOptional()
  readonly nombre?: string;
}
