import { ServicesService } from './services.service';
import { AVISO_SANCION } from '../notifications/avisos-catalogo';

/**
 * Avisos push al personal, con clave de dedupe para que un reintento o dos
 * replicas no lo dupliquen. Aqui se prueban los que no existian antes por ningun otro
 * canal: el rechazo de ofertas, el regreso pendiente y el servicio encadenado.
 */
describe('ServicesService avisos al personal', () => {
  function armar(extra: Record<string, unknown> = {}) {
    const notificar = jest.fn().mockResolvedValue(1);
    const service = Object.create(ServicesService.prototype) as ServicesService;
    Object.assign(service, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      waitTimeouts: new Map(),
      dispatchTimeouts: new Map(),
      notificationsService: { notificar },
      realtimeEventsService: {
        emitToBoss: jest.fn(),
        emitToJefes: jest.fn(),
        emitToEmployee: jest.fn(),
      },
      ...extra,
    });
    return { service, notificar };
  }

  describe('rechazo de ofertas del chofer', () => {
    function conChofer(rechazosPrevios: number) {
      const update = jest.fn().mockResolvedValue(undefined);
      const applyDriverRejectionFine = jest
        .fn()
        .mockResolvedValue({ id: 'sancion-1' });
      const armado = armar({
        serviciosRepository: {
          manager: {
            getRepository: () => ({
              findOne: jest.fn().mockResolvedValue({
                id: 'chofer-1',
                usuarioId: 'usuario-chofer',
                nombre: 'Luis',
                rechazosConsecutivos: rechazosPrevios,
              }),
              update,
            }),
          },
        },
        disciplineService: { applyDriverRejectionFine },
      });
      const registrar = (
        armado.service as unknown as {
          registrarRechazoDeChofer: (c: string, v: string) => Promise<void>;
        }
      ).registrarRechazoDeChofer.bind(armado.service);
      return { ...armado, registrar, applyDriverRejectionFine };
    }

    it('le avisa la racha por push, silenciable como sancion', async () => {
      const { registrar, notificar } = conChofer(0);

      await registrar('chofer-1', 'viaje-1');

      expect(notificar).toHaveBeenCalledWith(
        'usuario-chofer',
        expect.objectContaining({
          titulo: 'Rechazaste 1 de 3 ofertas',
          tipo: AVISO_SANCION,
          url: '/chofer/portal',
          dedupeKey: 'driver:offer_rejected:viaje-1:chofer-1',
        }),
      );
    });

    it('al tercero aplica la multa y la avisa con la clave de la sancion', async () => {
      const { registrar, notificar, applyDriverRejectionFine } = conChofer(2);

      await registrar('chofer-1', 'viaje-1');

      expect(applyDriverRejectionFine).toHaveBeenCalledWith('chofer-1', 3, 100);
      expect(notificar).toHaveBeenCalledWith(
        'usuario-chofer',
        expect.objectContaining({
          titulo: 'Se aplicó una multa',
          dedupeKey: 'driver:rejection_fine:sancion-1',
        }),
      );
    });
  });

  describe('regreso pendiente', () => {
    const servicio = {
      id: 'srv-1',
      jefeId: 'jefe-1',
      estado: 'finalizado',
      // El principal coincide con el del servicio: no se le avisa dos veces.
      empleada: { jefeId: 'jefe-1', jefeSecundarioId: 'jefe-2' },
    };

    it('avisa a cada jefe de la modelo una sola vez, por push', async () => {
      const { service, notificar } = armar({
        serviciosRepository: {
          findOne: jest.fn().mockResolvedValue(servicio),
          update: jest.fn().mockResolvedValue(undefined),
        },
        liquidationSync: {
          syncOfficeRecord: jest.fn().mockResolvedValue(undefined),
        },
      });

      await service.requestReturnTransport('srv-1');

      const destinos = notificar.mock.calls.map(([usuarioId]) => usuarioId);
      expect(destinos.sort()).toEqual(['jefe-1', 'jefe-2']);
      expect(notificar).toHaveBeenCalledWith(
        'jefe-2',
        expect.objectContaining({
          url: '/jefe',
          dedupeKey: 'boss:return_transport_requested:srv-1:finalizado',
        }),
      );
    });

    it('cada recordatorio lleva su numero en la clave', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const { service, notificar } = armar({
        serviciosRepository: {
          find: jest
            .fn()
            .mockResolvedValue([{ ...servicio, recordatoriosRegreso: 1 }]),
          update,
        },
      });

      await service.processReturnTransportReminders();

      expect(notificar).toHaveBeenCalledWith(
        'jefe-2',
        expect.objectContaining({
          dedupeKey: 'boss:return_transport_requested:srv-1:recordatorio-2',
        }),
      );
      expect(update).toHaveBeenCalledWith(
        'srv-1',
        expect.objectContaining({ recordatoriosRegreso: 2 }),
      );
    });
  });

  it('el servicio encadenado en el mismo sitio se le avisa a la modelo por push', async () => {
    const { service, notificar } = armar({
      serviciosRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'srv-2',
          notasJefe: 'nota privada',
          empleada: { usuarioId: 'usuario-modelo' },
          cliente: { nombre: 'Andres' },
        }),
      },
    });

    await service.notifyScheduledServiceStarted('srv-2');

    expect(notificar).toHaveBeenCalledWith(
      'usuario-modelo',
      expect.objectContaining({
        url: '/empleada/servicio',
        dedupeKey: 'employee:scheduled_service_started:srv-2',
      }),
    );
    // Ni el cliente ni las notas viajan en un aviso que sale en la pantalla
    // de bloqueo.
    const [, aviso] = notificar.mock.calls[0] as [
      string,
      { titulo: string; cuerpo: string },
    ];
    expect(`${aviso.titulo} ${aviso.cuerpo}`).not.toMatch(/Andres|nota/);
  });
});
