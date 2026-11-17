import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ACCESS_COOKIE } from '../auth.constants';
import { leerSesionActual } from './sesion-actual.decorator';

function token(payload: object): string {
  const parte = (valor: object) =>
    Buffer.from(JSON.stringify(valor)).toString('base64url');
  return `${parte({ alg: 'HS256', typ: 'JWT' })}.${parte(payload)}.firma`;
}

function peticion(opciones: { bearer?: string; cookie?: string }): Request {
  return {
    headers: opciones.bearer
      ? { authorization: `Bearer ${opciones.bearer}` }
      : {},
    signedCookies: opciones.cookie ? { [ACCESS_COOKIE]: opciones.cookie } : {},
  } as unknown as Request;
}

describe('leerSesionActual', () => {
  it('lee sid y familia del token de la cookie firmada', () => {
    const request = peticion({
      cookie: token({ sub: 'u-1', sid: 's-1', familyId: 'f-1' }),
    });
    expect(leerSesionActual(request)).toEqual({ sid: 's-1', familyId: 'f-1' });
  });

  it('prefiere el Bearer, igual que JwtStrategy', () => {
    const request = peticion({
      bearer: token({ sid: 's-bearer', familyId: 'f-bearer' }),
      cookie: token({ sid: 's-cookie', familyId: 'f-cookie' }),
    });
    expect(leerSesionActual(request)).toEqual({
      sid: 's-bearer',
      familyId: 'f-bearer',
    });
  });

  it('un token sin familia deja la familia en null', () => {
    const request = peticion({ cookie: token({ sid: 's-1' }) });
    expect(leerSesionActual(request)).toEqual({ sid: 's-1', familyId: null });
  });

  it.each([
    ['sin token', peticion({})],
    ['sin sid', peticion({ cookie: token({ sub: 'u-1' }) })],
    ['mal formado', peticion({ cookie: 'no-es-un-jwt' })],
    ['payload ilegible', peticion({ cookie: 'a.%%%.c' })],
  ])('responde 401 %s', (_caso, request) => {
    expect(() => leerSesionActual(request)).toThrow(UnauthorizedException);
  });
});
