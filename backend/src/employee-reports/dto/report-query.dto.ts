import { finDelDia, inicioDelDia } from '../../common/dias-del-negocio';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  REPORT_CATEGORIES,
  REPORT_ORIGINS,
  REPORT_PRIORITIES,
  REPORT_STATUSES,
} from '../entities/employee-report.entity';
import type {
  ReportCategory,
  ReportOrigin,
  ReportPriority,
  ReportStatus,
} from '../entities/employee-report.entity';

export class ReportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional()
  @IsEnum(REPORT_STATUSES)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: REPORT_PRIORITIES })
  @IsOptional()
  @IsEnum(REPORT_PRIORITIES)
  priority?: ReportPriority;

  @ApiPropertyOptional({ enum: REPORT_CATEGORIES })
  @IsOptional()
  @IsEnum(REPORT_CATEGORIES)
  category?: ReportCategory;

  @ApiPropertyOptional({ enum: REPORT_ORIGINS })
  @IsOptional()
  @IsEnum(REPORT_ORIGINS)
  origin?: ReportOrigin;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @IsUUID('4')
  bossId?: string;

  @IsOptional()
  @Transform(({ value }) => inicioDelDia(value))
  @IsDate()
  from?: Date;

  @IsOptional()
  @Transform(({ value }) => finDelDia(value))
  @IsDate()
  to?: Date;
}
