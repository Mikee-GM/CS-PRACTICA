import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  REPORT_CATEGORIES,
  type ReportCategory,
} from '../../employee-reports/entities/employee-report.entity';

/**
 * Los mismos motivos que ofrecen los botones del bot despues de una
 * calificacion de tres estrellas o menos.
 */
export const MOTIVOS_DE_CALIFICACION = [
  'trato',
  'puntualidad',
  'comunicacion',
  'otro',
] as const;
export type MotivoDeCalificacion = (typeof MOTIVOS_DE_CALIFICACION)[number];

// Se recorta antes de validar: un texto hecho solo de espacios es un texto
// vacio y no debe pasar el minimo de longitud.
const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Filtro opcional de la lista: el chat solo muestra lo de su modelo. */
export class PendientesDeValorarQueryDto {
  @ApiPropertyOptional({ description: 'Id de la modelo del chat' })
  @IsOptional()
  @IsUUID()
  readonly empleadaId?: string;
}

/**
 * Calificacion del cliente a un servicio suyo.
 *
 * A diferencia de la empleada y el chofer, el cliente no esta obligado a
 * comentar una calificacion baja: en el bot tampoco lo estaba, y exigirlo en
 * la web solo haria que no calificara. El motivo es la version corta del
 * comentario y solo se guarda si no escribio uno.
 */
export class CalificarServicioDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  readonly estrellas: number;

  @ApiPropertyOptional({
    description:
      'Solo en un servicio grupal: la participante a la que se califica',
  })
  @IsOptional()
  @IsUUID()
  readonly empleadaId?: string;

  @ApiPropertyOptional({ enum: MOTIVOS_DE_CALIFICACION })
  @IsOptional()
  @IsIn(MOTIVOS_DE_CALIFICACION)
  readonly motivo?: MotivoDeCalificacion;

  @ApiPropertyOptional({ minLength: 3, maxLength: 2000 })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  readonly comentario?: string;
}

/** Mismos limites que el reporte del bot: entre 3 y 2000 caracteres. */
export class ReportarServicioDto {
  @ApiProperty({ enum: REPORT_CATEGORIES })
  @IsIn(REPORT_CATEGORIES)
  readonly categoria: ReportCategory;

  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @Transform(recortar)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  readonly descripcion: string;
}

/** El chofer reporta por viaje: es el id que conoce su portal. */
export class ReportarViajeDto extends ReportarServicioDto {
  @ApiProperty({ description: 'Viaje finalizado del chofer' })
  @IsUUID()
  readonly viajeId: string;
}
