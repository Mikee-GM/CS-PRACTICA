import { ConflictException } from '@nestjs/common';
import { ServicesService } from './services.service';

/**
 * Marcar «lista» o terminar un servicio que todavia no empezo decia «ya no esta
 * activo», como si hubiera terminado. Falta aceptarlo o iniciarlo, y el equipo
 * necesita saber cual de las dos cosas pasa.
 */
describe('ServicesService.cerrarServicio: servicio que no esta en curso', () => {
  const service = Object.create(ServicesService.prototype) as ServicesService;
  const cerrar = (estado: string) =>
    (
      service as unknown as {
        cerrarServicio: (s: { estado: string }) => Promise<unknown>;
      }
    ).cerrarServicio({ estado });

  it.each(['pendiente', 'agendado'])(
    'un servicio %s dice que todavia no ha empezado',
    async (estado) => {
      await expect(cerrar(estado)).rejects.toThrow(
        'Este servicio todavia no ha empezado',
      );
    },
  );

  it.each(['finalizado', 'cancelado', 'rechazado'])(
    'un servicio %s sigue diciendo que ya no esta activo',
    async (estado) => {
      const error = await cerrar(estado).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe('Este servicio ya no está activo');
    },
  );
});
