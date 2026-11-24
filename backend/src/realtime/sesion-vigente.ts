import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { catchError, exhaustMap, filter, from, interval, Observable, of } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Repository } from 'typeorm';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { GRACIA_DE_ROTACION_MS } from '../auth/strategies/jwt.strategy';
import { Usuarios } from '../users/entities/user.entity';

/** Cada cuanto se vuelve a comprobar que la sesion de un flujo siga valiendo. */
export const REVISION_DE_SESION_MS = 20_000;

/**
 * Corta un flujo en vivo cuando su sesion deja de valer.
 *
 * La sesion se comprueba una sola vez, al conectar. Un flujo SSE dura horas, asi
 * que cerrar sesion, revocar la familia por reutilizar un token, restablecer la
 * clave o desactivar la cuenta dejaban el flujo entregando ubicaciones y chats a
 * quien ya no tenia sesion. Aqui el flujo se completa en cuanto la sesion cae; el
 * navegador reconecta solo y, si ya no tiene sesion, recibe un 401 y se detiene.
 *
 * Un fallo al comprobar (la base se cayo un instante) NO corta el flujo: cortar
 * a todos los usuarios por un parpadeo de la base seria peor que esperar al
 * siguiente turno.
 */
export function mientrasLaSesionValga<T>(
  flujo: Observable<T>,
  estaVigente: () => Promise<boolean>,
  cadaMs: number = REVISION_DE_SESION_MS,
): Observable<T> {
  const caducada$ = interval(cadaMs).pipe(
    // `exhaustMap`: si una comprobacion tarda, no se apilan otras detras.
    exhaustMap(() => from(estaVigente()).pipe(catchError(() => of(true)))),
    filter((vigente) => !vigente),
  );
  return flujo.pipe(takeUntil(caducada$));
}

/**
 * Misma regla que `JwtStrategy.validate`: la sesion existe, no caduco, no esta
 * revocada (salvo la rotacion reciente) y el usuario sigue activo.
 */
@Injectable()
export class VigilanteDeSesion {
  constructor(
    @InjectRepository(AuthSession)
    private readonly sesiones: Repository<AuthSession>,
    @InjectRepository(Usuarios)
    private readonly usuarios: Repository<Usuarios>,
  ) {}

  async estaVigente(userId: string, sid: string): Promise<boolean> {
    const sesion = await this.sesiones.findOne({
      where: { id: sid, userId },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        replacedBySessionId: true,
      },
    });
    if (!sesion || sesion.expiresAt.getTime() <= Date.now()) return false;

    if (sesion.revokedAt) {
      const rotacionReciente =
        Boolean(sesion.replacedBySessionId) &&
        Date.now() - sesion.revokedAt.getTime() < GRACIA_DE_ROTACION_MS;
      if (!rotacionReciente) return false;
    }

    const usuario = await this.usuarios.findOne({
      where: { id: userId, activo: true },
      select: { id: true },
    });
    return Boolean(usuario);
  }
}
