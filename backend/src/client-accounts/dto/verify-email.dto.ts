import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token recibido en el enlace del correo' })
  @IsString()
  @Length(64, 64)
  token: string;
}
