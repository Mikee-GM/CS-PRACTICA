import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const MAX_MESSAGE_LENGTH = 2000;

export class SendMessageDto {
  // Se recorta antes de validar para que un mensaje de solo espacios cuente
  // como vacio y no llegue a la conversacion.
  @ApiProperty({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'El mensaje no puede estar vacío' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres`,
  })
  readonly body: string;

  @ApiProperty({
    description:
      'Uuid que genera el navegador; reenviar el mismo devuelve el mensaje ya guardado',
  })
  @IsUUID()
  readonly clientMessageId: string;
}
