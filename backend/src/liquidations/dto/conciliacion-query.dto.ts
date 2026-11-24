import { IsOptional, Matches } from 'class-validator';

const FECHA = { message: 'La fecha debe tener el formato AAAA-MM-DD' };

/** Periodo de la conciliacion. Sin parametros, la semana en curso. */
export class ConciliacionQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, FECHA)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, FECHA)
  to?: string;
}
