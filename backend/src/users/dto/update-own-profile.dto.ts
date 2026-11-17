import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Lo unico que el personal puede cambiar de su propia cuenta.
 *
 * La lista es cerrada a proposito: email, rol y `activo` los decide el admin, y
 * con el `ValidationPipe` global (`forbidNonWhitelisted`) cualquier otro campo
 * responde 400 en vez de ignorarse en silencio.
 */
export class UpdateOwnProfileDto {
  // Se recorta antes de validar: un nombre hecho solo de espacios es vacio.
  @ApiPropertyOptional({ example: 'Juan', minLength: 1, maxLength: 255 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre no puede quedar vacío' })
  @MaxLength(255)
  nombre?: string;

  @ApiPropertyOptional({ example: 'Pérez', minLength: 1, maxLength: 255 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El apellido no puede quedar vacío' })
  @MaxLength(255)
  apellido?: string;

  // 50 es el ancho de la columna `usuarios.telefono`.
  @ApiPropertyOptional({ example: '+524421234567', maxLength: 50 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(50, { message: 'El teléfono no puede superar los 50 caracteres' })
  telefono?: string;
}
