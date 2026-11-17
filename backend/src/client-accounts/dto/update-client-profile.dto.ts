import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateClientProfileDto {
  // Se recorta antes de validar: un nombre hecho solo de espacios es un nombre
  // vacio y no debe pasar como valido.
  @ApiProperty({ example: 'Carlos', minLength: 1, maxLength: 255 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'El nombre no puede quedar vacío' })
  @MaxLength(255)
  nombre: string;
}
