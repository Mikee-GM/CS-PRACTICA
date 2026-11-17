import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CalificarServicioDto,
  ReportarServicioDto,
  ReportarViajeDto,
} from './service-feedback.dto';

async function errores<T extends object>(
  clase: new () => T,
  cuerpo: Record<string, unknown>,
): Promise<string[]> {
  const fallos = await validate(plainToInstance(clase, cuerpo));
  return fallos.map((fallo) => fallo.property);
}

describe('DTOs de valoracion del servicio', () => {
  it('las estrellas van de 1 a 5 y llegan como numero', async () => {
    expect(await errores(CalificarServicioDto, { estrellas: '4' })).toEqual([]);
    expect(await errores(CalificarServicioDto, { estrellas: 0 })).toEqual([
      'estrellas',
    ]);
    expect(await errores(CalificarServicioDto, { estrellas: 6 })).toEqual([
      'estrellas',
    ]);
  });

  it('una calificacion baja no exige comentario, como en el bot', async () => {
    expect(await errores(CalificarServicioDto, { estrellas: 1 })).toEqual([]);
  });

  it('el motivo solo admite los del bot', async () => {
    expect(
      await errores(CalificarServicioDto, { estrellas: 2, motivo: 'precio' }),
    ).toEqual(['motivo']);
  });

  it('un comentario hecho de espacios no pasa', async () => {
    expect(
      await errores(CalificarServicioDto, { estrellas: 2, comentario: '    ' }),
    ).toEqual(['comentario']);
  });

  it('el reporte exige una categoria conocida y una descripcion real', async () => {
    expect(
      await errores(ReportarServicioDto, {
        categoria: 'cobro',
        descripcion: 'Me cobraron de mas',
      }),
    ).toEqual([]);
    expect(
      (
        await errores(ReportarServicioDto, {
          categoria: 'inventada',
          descripcion: '  a ',
        })
      ).sort(),
    ).toEqual(['categoria', 'descripcion']);
  });

  it('el del chofer pide ademas el viaje', async () => {
    expect(
      await errores(ReportarViajeDto, {
        categoria: 'otro',
        descripcion: 'Descripcion valida',
      }),
    ).toEqual(['viajeId']);
  });
});
