import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateStaffPostDto,
  ListStaffPostsDto,
  MAX_MOTIVO_RECHAZO_POST,
  RejectPostDto,
} from './staff-posts.dto';

function errores<T extends object>(
  clase: new () => T,
  datos: object,
): string[] {
  return validateSync(plainToInstance(clase, datos)).map((e) => e.property);
}

describe('DTOs de /staff/posts', () => {
  it('rechazar exige motivo de 1 a 500 caracteres, recortado', () => {
    expect(errores(RejectPostDto, {})).toEqual(['motivo']);
    expect(errores(RejectPostDto, { motivo: '   ' })).toEqual(['motivo']);
    expect(
      errores(RejectPostDto, {
        motivo: 'x'.repeat(MAX_MOTIVO_RECHAZO_POST + 1),
      }),
    ).toEqual(['motivo']);
    expect(errores(RejectPostDto, { motivo: ' Foto borrosa ' })).toEqual([]);
    expect(
      plainToInstance(RejectPostDto, { motivo: ' Foto borrosa ' }).motivo,
    ).toBe('Foto borrosa');
  });

  it('la cola admite estado, modelo, cursor y limit 1..50', () => {
    expect(errores(ListStaffPostsDto, {})).toEqual([]);
    expect(
      errores(ListStaffPostsDto, { estado: 'aprobado', limit: '50' }),
    ).toEqual([]);
    expect(errores(ListStaffPostsDto, { estado: 'publicado' })).toEqual([
      'estado',
    ]);
    expect(errores(ListStaffPostsDto, { limit: '0' })).toEqual(['limit']);
    expect(errores(ListStaffPostsDto, { limit: '51' })).toEqual(['limit']);
    expect(errores(ListStaffPostsDto, { employeeId: 'x' })).toEqual([
      'employeeId',
    ]);
  });

  it('crear exige la modelo y valida el texto como el de la modelo', () => {
    expect(errores(CreateStaffPostDto, { caption: 'Hola' })).toEqual([
      'employeeId',
    ]);
    expect(
      errores(CreateStaffPostDto, {
        employeeId: '11111111-1111-4111-8111-111111111111',
        caption: 'x'.repeat(2001),
      }),
    ).toEqual(['caption']);
  });
});
