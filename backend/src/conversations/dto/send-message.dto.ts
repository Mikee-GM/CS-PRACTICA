import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_ADDRESS_LENGTH = 240;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Ubicacion que comparte el cliente (el pin del navegador). Solo se validan
 * los rangos: si cae dentro de la zona que se atiende lo decide el turno de la
 * reserva, que es quien sabe contestarle en la conversacion.
 */
export class MessageLocationDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  readonly lat: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  readonly lng: number;

  @ApiPropertyOptional({ maxLength: MAX_ADDRESS_LENGTH })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(MAX_ADDRESS_LENGTH)
  readonly address?: string;
}

export class SendMessageDto {
  // Se recorta antes de validar para que un mensaje de solo espacios cuente
  // como vacio. Con ubicacion el texto puede faltar: el pin ya es el mensaje.
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: MAX_MESSAGE_LENGTH,
    description: 'Obligatorio salvo que el mensaje lleve `location`',
  })
  @Transform(recortar)
  @ValidateIf(
    (dto: SendMessageDto) =>
      !dto.location || (dto.body !== undefined && dto.body !== ''),
  )
  @IsString()
  @MinLength(1, { message: 'El mensaje no puede estar vacío' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres`,
  })
  readonly body?: string;

  @ApiProperty({
    description:
      'Uuid que genera el navegador; reenviar el mismo devuelve el mensaje ya guardado',
  })
  @IsUUID()
  readonly clientMessageId: string;

  @ApiPropertyOptional({ type: MessageLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageLocationDto)
  readonly location?: MessageLocationDto;
}
