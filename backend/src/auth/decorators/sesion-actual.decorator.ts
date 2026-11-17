import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { extraerAccessToken } from '../strategies/jwt.strategy';

export type SesionActual = {
  sid: string;
  familyId: string | null;
};

/**
 * Sesion a la que pertenece el access token de esta peticion.
 *
 * `JwtStrategy.validate` devuelve el `Usuarios` y no el payload, y cambiarlo
 * romperia a todo lo que usa `@GetUser()`. En vez de eso se vuelve a leer el
 * token con el mismo extractor que uso la estrategia y se decodifica sin
 * verificar: es seguro solo porque `JwtAuthGuard` ya verifico la firma de ese
 * mismo token en esta peticion. Por eso el decorador exige ir detras de ese
 * guard y nunca debe usarse en una ruta sin el.
 */
export function leerSesionActual(request: Request): SesionActual {
  const token = extraerAccessToken(request);
  const payload = token ? decodificarPayload(token) : null;
  if (!payload || typeof payload.sid !== 'string' || !payload.sid) {
    throw new UnauthorizedException('Token sin sesión asociada');
  }
  return {
    sid: payload.sid,
    familyId: typeof payload.familyId === 'string' ? payload.familyId : null,
  };
}

export const SesionActual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SesionActual =>
    leerSesionActual(ctx.switchToHttp().getRequest<Request>()),
);

function decodificarPayload(
  token: string,
): { sid?: unknown; familyId?: unknown } | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(partes[1], 'base64url').toString('utf8'),
    );
    return typeof payload === 'object' && payload !== null ? payload : null;
  } catch {
    return null;
  }
}
