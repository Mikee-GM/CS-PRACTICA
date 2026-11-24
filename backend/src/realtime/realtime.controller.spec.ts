import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { Usuarios } from '../users/entities/user.entity';
import { RealtimeController } from './realtime.controller';

const SESION = { sid: 'sid-1', familyId: null };
const primerValor = (flujo: unknown) => firstValueFrom(flujo as any);

/*
 * sseChofer entra con JwtAuthGuard y comprueba el rol a mano, como los demas
 * canales: un rol ajeno recibe 403 antes de tocar el repositorio.
 */
describe('RealtimeController.sseChofer', () => {
  const realtimeEventsService = { getDriverStream: jest.fn() };
  const vigilante = { estaVigente: jest.fn().mockResolvedValue(true) };
  const empleadasRepository = { findOne: jest.fn() };
  const choferesRepository = { findOne: jest.fn() };
  const clientesRepository = { findOne: jest.fn() };

  const controller = new RealtimeController(
    realtimeEventsService as any,
    vigilante as any,
    empleadasRepository as any,
    choferesRepository as any,
    clientesRepository as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('conecta al canal del chofer resuelto por el usuario de la sesion', async () => {
    choferesRepository.findOne.mockResolvedValue({ id: 'driver-1' });
    const stream = of({ data: 'x' });
    realtimeEventsService.getDriverStream.mockReturnValue(stream);

    const result = await controller.sseChofer(
      { user: { id: 'user-1', rol: 'chofer' } as Usuarios },
      SESION,
    );

    expect(choferesRepository.findOne).toHaveBeenCalledWith({
      where: { usuarioId: 'user-1' },
      select: { id: true },
    });
    expect(realtimeEventsService.getDriverStream).toHaveBeenCalledWith(
      'driver-1',
    );
    expect(await primerValor(result)).toEqual({ data: 'x' });
  });

  it('rechaza cuando el usuario autenticado no tiene perfil de chofer', async () => {
    choferesRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.sseChofer(
        { user: { id: 'user-2', rol: 'chofer' } as Usuarios },
        SESION,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtimeEventsService.getDriverStream).not.toHaveBeenCalled();
  });

  it.each(['jefe', 'admin', 'empleada', 'cliente'] as const)(
    'niega el canal del chofer al rol %s',
    async (rol) => {
      await expect(
        controller.sseChofer(
          { user: { id: 'user-3', rol } as Usuarios },
          SESION,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(choferesRepository.findOne).not.toHaveBeenCalled();
      expect(realtimeEventsService.getDriverStream).not.toHaveBeenCalled();
    },
  );
});

/*
 * Los canales con JwtAuthGuard no pasan por RolesGuard: cada metodo comprueba
 * el rol a mano. Estas pruebas fijan que el canal del cliente solo admite
 * clientes y que un cliente --cuenta que cualquiera puede crear-- no abre los
 * canales del personal.
 */
describe('RealtimeController: canal del cliente y separacion de roles', () => {
  const realtimeEventsService = {
    getClientStream: jest.fn(),
    getJefesStream: jest.fn(),
    getBossStream: jest.fn(),
    getEmployeeStream: jest.fn(),
  };
  const vigilante = { estaVigente: jest.fn().mockResolvedValue(true) };
  const empleadasRepository = { findOne: jest.fn() };
  const choferesRepository = { findOne: jest.fn() };
  const clientesRepository = { findOne: jest.fn() };

  const controller = new RealtimeController(
    realtimeEventsService as any,
    vigilante as any,
    empleadasRepository as any,
    choferesRepository as any,
    clientesRepository as any,
  );

  const peticion = (rol: Usuarios['rol'], id = 'user-1') => ({
    user: { id, rol } as Usuarios,
  });

  beforeEach(() => jest.clearAllMocks());

  it('conecta al cliente con el canal de su ficha', async () => {
    clientesRepository.findOne.mockResolvedValue({ id: 'cliente-1' });
    const stream = of({ data: 'x' });
    realtimeEventsService.getClientStream.mockReturnValue(stream);

    const result = await controller.sseCliente(peticion('cliente'), SESION);

    expect(clientesRepository.findOne).toHaveBeenCalledWith({
      where: { usuarioId: 'user-1' },
      select: { id: true },
    });
    expect(realtimeEventsService.getClientStream).toHaveBeenCalledWith(
      'cliente-1',
    );
    expect(await primerValor(result)).toEqual({ data: 'x' });
  });

  it('responde 404 al cliente sin ficha', async () => {
    clientesRepository.findOne.mockResolvedValue(null);

    await expect(
      controller.sseCliente(peticion('cliente'), SESION),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtimeEventsService.getClientStream).not.toHaveBeenCalled();
  });

  it.each(['jefe', 'admin', 'empleada', 'chofer'] as const)(
    'niega el canal del cliente al rol %s',
    async (rol) => {
      await expect(
        controller.sseCliente(peticion(rol), SESION),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(clientesRepository.findOne).not.toHaveBeenCalled();
      expect(realtimeEventsService.getClientStream).not.toHaveBeenCalled();
    },
  );

  it('niega a un cliente el canal de jefes', () => {
    expect(() => controller.sseJefes(peticion('cliente'), SESION)).toThrow(
      ForbiddenException,
    );
    expect(realtimeEventsService.getJefesStream).not.toHaveBeenCalled();
    expect(realtimeEventsService.getBossStream).not.toHaveBeenCalled();
  });

  it('niega a un cliente el canal de empleada', async () => {
    await expect(
      controller.sseEmpleada(peticion('cliente'), SESION),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(empleadasRepository.findOne).not.toHaveBeenCalled();
  });
});
