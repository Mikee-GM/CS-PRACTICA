import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangeClientPasswordDto {
  // La actual no repite las reglas de la nueva: una cuenta creada antes de que
  // existieran debe poder cambiarla igual.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  actual: string;

  // Mismas reglas que `RegisterClientDto.password`; bcrypt solo mira los
  // primeros 72 bytes.
  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[A-Za-z]/, { message: 'La contraseña debe incluir una letra' })
  @Matches(/\d/, { message: 'La contraseña debe incluir un número' })
  nueva: string;
}
