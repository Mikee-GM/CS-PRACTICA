import { ForbiddenException } from '@nestjs/common';
import { DisciplineService } from './discipline.service';

/**
 * Los choferes que la modelo todavia puede calificar.
 *
 * La identidad sale de la sesion y el plazo es el mismo que hace cumplir la
 * calificacion: si la lista ofreciera viajes fuera de el, el portal
 * mostraria una opcion que el servidor rechaza.
 */
describe('DisciplineService.listarChoferesPorCalificar', () => {
  function armar(identidad: Record<string, unknown>[] = [{ id: 'emp-1' }]) {
    const query = jest
      .fn()
      .mockResolvedValueOnce(identidad)
      .mockResolvedValueOnce([{ viajeId: 'viaje-1' }]);
    // Por nombre y no por posicion: una dependencia nueva no desplaza dobles.
    const service = Object.create(
      DisciplineService.prototype,
    ) as DisciplineService;
    Object.assign(service, { dataSource: { query } });
    return { service, query };
  }

  it('busca con la modelo de la sesion y el plazo de 24 horas', async () => {
    const { service, query } = armar();

    const filas: unknown = await service.listarChoferesPorCalificar({
      id: 'user-1',
      rol: 'empleada',
    } as never);

    expect(filas).toEqual([{ viajeId: 'viaje-1' }]);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM empleadas'),
      ['user-1'],
    );
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['emp-1', 24 * 60 * 60 * 1000]);
    expect(sql).toContain("r.direction = 'employee_to_driver'");
    expect(sql).toContain('JOIN choferes');
  });

  it('un chofer no tiene choferes que calificar', async () => {
    const { service, query } = armar([{ id: 'chofer-1' }]);

    await expect(
      service.listarChoferesPorCalificar({
        id: 'user-2',
        rol: 'chofer',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('una cuenta de modelo sin ficha tampoco', async () => {
    const { service } = armar([]);

    await expect(
      service.listarChoferesPorCalificar({
        id: 'user-3',
        rol: 'empleada',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
