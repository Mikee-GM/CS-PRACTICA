import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Cambio de contraseña propio del personal. Es el mismo contrato que
 * `ChangeClientPasswordDto`; vive aparte para que el modulo de usuarios no
 * dependa del de cuentas de cliente.
 */
export class ChangeOwnPasswordDto {
  // La actual no repite las reglas de la nueva: las cuentas creadas antes de
  // que existieran (minimo 6, sin numero) deben poder cambiarla igual.
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
