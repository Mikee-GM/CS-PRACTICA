import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { RATING_DIRECTIONS } from '../entities/interaction-rating.entity';
import type { RatingDirection } from '../entities/interaction-rating.entity';
import { CONDUCT_CATEGORIES } from '../entities/conduct-report.entity';
import type { ConductCategory } from '../entities/conduct-report.entity';

export class CreateRatingDto {
  @IsIn(RATING_DIRECTIONS) direction: RatingDirection;
  @IsUUID() interactionId: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) stars: number;
  @ValidateIf((value: CreateRatingDto) => value.stars <= 2)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  comment?: string;
}

export class CreateConductReportDto {
  @IsIn(RATING_DIRECTIONS) direction: RatingDirection;
  @IsUUID() interactionId: string;
  @IsIn(CONDUCT_CATEGORIES) category: ConductCategory;
  @IsString() @MinLength(3) @MaxLength(2000) description: string;
}

export class CloseConductReportDto {
  @IsIn(['confirmado', 'no_sustentado'])
  outcome: 'confirmado' | 'no_sustentado';
  @IsString() @MinLength(3) @MaxLength(2000) resolution: string;
}

export class CreateSanctionDto {
  @IsIn(['client', 'employee', 'driver', 'boss'])
  subjectType: 'client' | 'employee' | 'driver' | 'boss';
  @IsUUID() subjectId: string;
  @IsIn(['suspension', 'permanent_ban', 'fine'])
  type: 'suspension' | 'permanent_ban' | 'fine';
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
  @IsOptional() @IsUUID() conductReportId?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @ValidateIf((value: CreateSanctionDto) => value.type === 'suspension')
  @IsDateString()
  endsAt?: string;
  @ValidateIf((value: CreateSanctionDto) => value.type === 'fine')
  @Type(() => Number)
  @Min(1)
  fineAmount?: number;
}

export class RevokeSanctionDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

/**
 * El motivo con el que alguien apela una calificacion.
 *
 * Se exige un minimo real porque quien resuelve la apelacion solo tiene esto
 * para decidir: un "no estoy de acuerdo" no le sirve de nada, y aceptarlo seria
 * hacerle perder el tiempo a las dos partes.
 */
export class AppealRatingDto {
  @IsString()
  @MinLength(15)
  @MaxLength(2000)
  reason: string;
}

/** El minimo para que un descargo diga algo. Mismo criterio que la apelacion. */
export const MIN_LARGO_DESCARGO = 15;

/** La version de quien fue reportado, escrita por ella o por el. */
export class ReportStatementDto {
  @IsString()
  @MinLength(MIN_LARGO_DESCARGO)
  @MaxLength(2000)
  statement: string;
}

export class ResolveAppealDto {
  @IsIn(['upheld', 'overturned'])
  decision: 'upheld' | 'overturned';
}

/** Tope de una pagina de reportes: lo bastante grande para el panel actual. */
export const MAX_LIMITE_REPORTES = 500;

/**
 * Filtros de GET /discipline/reports.
 *
 * Antes llegaban como `Record<string, string>`, que el ValidationPipe no
 * inspecciona: cualquier texto entraba al QueryBuilder y no habia tope de
 * filas. `limit` sigue siendo opcional para no cambiar el contrato: sin el, el
 * listado se comporta como siempre.
 */
export class ListConductReportsQueryDto {
  // `direction` queda como texto: los reportes del sistema usan valores que no
  // estan en RATING_DIRECTIONS.
  @IsOptional() @IsString() @MaxLength(40) direction?: string;
  @IsOptional() @IsIn(['client', 'employee', 'driver']) subjectType?: string;
  @IsOptional() @IsIn(['normal', 'alta', 'urgente']) priority?: string;
  @IsOptional() @IsIn(['nuevo', 'en_revision', 'cerrado']) status?: string;
  @IsOptional() @IsIn(['confirmado', 'no_sustentado']) outcome?: string;
  @IsOptional() @IsIn(CONDUCT_CATEGORIES) category?: ConductCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMITE_REPORTES)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
