import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  CONVERSATION_STATUSES,
  type ConversationStatus,
} from '../entities/conversation.entity';
import { MAX_MESSAGE_LENGTH } from './send-message.dto';

export const MAX_BUSQUEDA_LENGTH = 100;
export const MAX_MOTIVO_RECHAZO_LENGTH = 500;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Un query param booleano llega como texto; solo `true` cuenta como si. */
const booleanoDeQuery = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class ListStaffConversationsDto {
  @ApiPropertyOptional({
    enum: CONVERSATION_STATUSES,
    description:
      'Solo las de ese estado. Sin el, todas menos las cerradas (para verlas hay que pedir `cerrada`).',
  })
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES)
  readonly estado?: ConversationStatus;

  @ApiPropertyOptional({
    maxLength: MAX_BUSQUEDA_LENGTH,
    description:
      'Busca en el nombre artistico de la modelo y en el nombre o correo del cliente',
  })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(MAX_BUSQUEDA_LENGTH)
  readonly q?: string;
}

export class SendStaffMessageDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH })
  @Transform(recortar)
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

export class TakeOverConversationDto {
  @ApiPropertyOptional({
    description:
      'Solo admin: quita la conversacion a quien la tenga. Para un jefe no tiene efecto.',
  })
  @IsOptional()
  @Transform(booleanoDeQuery)
  @IsBoolean()
  readonly forzar?: boolean;
}

export class ReleaseConversationDto {
  @ApiPropertyOptional({
    description:
      'Solo admin: devuelve al asistente una conversacion que atiende otra persona.',
  })
  @IsOptional()
  @Transform(booleanoDeQuery)
  @IsBoolean()
  readonly forzar?: boolean;
}

export class RejectBookingDraftDto {
  @ApiPropertyOptional({
    maxLength: MAX_MOTIVO_RECHAZO_LENGTH,
    description: 'Queda en el borrador para el equipo; el cliente no lo ve',
  })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(MAX_MOTIVO_RECHAZO_LENGTH)
  readonly motivo?: string;
}
