import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contexto(rol: string | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user: rol ? { rol } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function guardConRoles(roles: string[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: () => roles,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('deja pasar al personal en una ruta sin roles declarados', () => {
    expect(guardConRoles(undefined).canActivate(contexto('jefe'))).toBe(true);
  });

  it('cierra a un cliente en una ruta sin roles declarados', () => {
    expect(guardConRoles(undefined).canActivate(contexto('cliente'))).toBe(
      false,
    );
  });

  it('deja pasar a un cliente solo si la ruta lo nombra', () => {
    expect(guardConRoles(['cliente']).canActivate(contexto('cliente'))).toBe(
      true,
    );
    expect(guardConRoles(['jefe']).canActivate(contexto('cliente'))).toBe(
      false,
    );
  });

  it('rechaza una ruta con roles cuando no hay usuario', () => {
    expect(guardConRoles(['jefe']).canActivate(contexto(undefined))).toBe(
      false,
    );
  });
});
