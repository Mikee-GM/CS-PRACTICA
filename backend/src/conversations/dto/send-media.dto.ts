import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CHAT_AUDIO_MAX_BYTES,
  CHAT_IMAGE_MAX_BYTES,
} from '../../upload/chat-media';
import { MAX_MESSAGE_LENGTH } from './send-message.dto';

/** Una nota de voz no pasa de cinco minutos. */
export const MAX_AUDIO_MS = 5 * 60 * 1000;

/**
 * Campos de texto del multipart de `POST .../media`. El archivo va en `file` y
 * no pasa por aqui; que sea foto o audio lo decide el contenido, no un campo.
 */
export class SendMediaDto {
  @ApiProperty({
    description:
      'Uuid que genera el navegador; reenviar el mismo devuelve el mensaje ya guardado sin volver a subir el archivo',
  })
  @IsUUID()
  readonly clientMessageId: string;

  @ApiPropertyOptional({
    maxLength: MAX_MESSAGE_LENGTH,
    description: 'Texto que acompaña a la foto',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(MAX_MESSAGE_LENGTH)
  readonly body?: string;

  @ApiPropertyOptional({ description: 'Solo audio: duración en milisegundos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AUDIO_MS)
  readonly durationMs?: number;
}

/**
 * Opciones de Multer. El tope corta la subida mientras llega; el tipo real lo
 * decide `UploadService.uploadChatMedia` mirando los bytes, aqui solo se falla
 * pronto con lo que no es imagen ni audio.
 */
export const OPCIONES_DE_SUBIDA_DE_MEDIA = {
  limits: {
    fileSize: Math.max(CHAT_IMAGE_MAX_BYTES, CHAT_AUDIO_MAX_BYTES),
    files: 1,
  },
  fileFilter: (
    _req: unknown,
    file: { mimetype?: string },
    callback: (error: Error | null, aceptar: boolean) => void,
  ): void => {
    const tipo = (file.mimetype ?? '').toLowerCase();
    if (tipo.startsWith('image/') || tipo.startsWith('audio/')) {
      callback(null, true);
      return;
    }
    callback(
      new BadRequestException('Solo se pueden enviar fotos o audios'),
      false,
    );
  },
};
