import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ResponderPreguntaDto {
  @ApiProperty({ description: 'Opción elegida de la pregunta en curso' })
  @IsUUID()
  readonly opcionId: string;
}
