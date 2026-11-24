import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDate, IsOptional, IsUUID } from 'class-validator';
import { finDelDia, inicioDelDia } from '../../common/dias-del-negocio';

export class LiquidationPeriodQueryDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @Transform(({ value }: { value: unknown }) => inicioDelDia(value))
  @IsDate()
  startDate: Date;

  @ApiPropertyOptional({ format: 'date-time' })
  @Transform(({ value }: { value: unknown }) => finDelDia(value))
  @IsDate()
  endDate: Date;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  employeeId?: string;
}
