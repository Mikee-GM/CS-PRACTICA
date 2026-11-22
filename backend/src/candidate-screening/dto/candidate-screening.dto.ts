import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Opcion de una pregunta. Sin esta clase el arreglo solo se validaba como
 * arreglo: cada elemento entraba tal cual a la columna jsonb, con cualquier
 * forma y tamaño, y de ahi salia a la pantalla de la candidata.
 */
export class ScreeningOptionDto {
  @IsString() @MinLength(1) @MaxLength(500) text: string;
  @IsOptional() @IsBoolean() isCorrect?: boolean;
}

export class CreateScreeningQuestionDto {
  @IsString() @MinLength(3) @MaxLength(2000) text: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ScreeningOptionDto)
  options?: ScreeningOptionDto[];
}

export class UpdateScreeningQuestionDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(2000) text?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ScreeningOptionDto)
  options?: ScreeningOptionDto[];
}

export class ReorderScreeningQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  questionIds: string[];
}

export class CreateCandidateScreeningDto {
  @IsString() @MinLength(2) @MaxLength(255) candidateName: string;
  @IsOptional() @IsString() @MaxLength(30) candidatePhone?: string;
  @Type(() => String)
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  questionIds: string[];
}

export class PromoteCandidateScreeningDto {
  @IsUUID() employeeId: string;
}

/**
 * Respuesta de la candidata desde la web publica.
 *
 * `preguntaId` es la pregunta que la candidata tiene en pantalla: si ya no es
 * la pendiente (doble envio, otra pestana) se rechaza en
 * lugar de guardar esa respuesta como si fuera de la pregunta siguiente.
 * Segun la pregunta se manda `opcion` (indice de la opcion elegida) o `texto`.
 */
export class ResponderEvaluacionDto {
  @ApiProperty({ description: 'Pregunta que se esta respondiendo' })
  @IsUUID()
  preguntaId: string;

  @ApiPropertyOptional({ description: 'Indice de la opcion elegida' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  opcion?: number;

  @ApiPropertyOptional({ description: 'Respuesta escrita, de 2 a 4000' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  texto?: string;
}
