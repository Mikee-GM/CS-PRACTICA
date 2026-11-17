import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterClientDto {
  @ApiProperty({ example: 'cliente@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;

  // bcrypt solo mira los primeros 72 bytes: un tope mayor aceptaria
  // contrasenas cuyo final no cuenta.
  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[A-Za-z]/, { message: 'La contraseña debe incluir una letra' })
  @Matches(/\d/, { message: 'La contraseña debe incluir un número' })
  password: string;

  @ApiPropertyOptional({ example: 'Carlos' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nombre?: string;

  @ApiProperty({ description: 'Declara ser mayor de 18 años' })
  @Equals(true, { message: 'Debes ser mayor de 18 años para registrarte' })
  mayorDeEdad: boolean;

  @ApiProperty({ description: 'Acepta los términos y condiciones' })
  @Equals(true, { message: 'Debes aceptar los términos y condiciones' })
  aceptaTerminos: boolean;
}
