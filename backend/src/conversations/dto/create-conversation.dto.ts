import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * El cliente solo elige la modelo: quien es el cliente sale siempre de la
 * sesion, nunca del cuerpo.
 */
export class CreateConversationDto {
  @ApiProperty({ description: 'Id de la modelo elegida en el catalogo' })
  @IsUUID()
  readonly employeeId: string;
}
