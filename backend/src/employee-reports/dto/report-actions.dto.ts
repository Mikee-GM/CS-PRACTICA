import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REPORT_PRIORITIES } from '../entities/employee-report.entity';
import type { ReportPriority } from '../entities/employee-report.entity';

export class AssignReportDto {
  @IsUUID('4')
  adminId: string;
}

export class ChangeReportPriorityDto {
  @ApiProperty({ enum: REPORT_PRIORITIES })
  @IsEnum(REPORT_PRIORITIES)
  priority: ReportPriority;
}

export class ReportNoteDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(4000)
  note: string;
}

export class CloseReportDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(4000)
  resolution: string;
}
