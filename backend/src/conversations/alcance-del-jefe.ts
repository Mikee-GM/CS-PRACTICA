import { puedeAtender } from '../services/puede-atender';

/** Lo que hace falta saber de un jefe para decidir si atiende ahora. */
export type JefeDeLaModelo = {
  id: string;
  activo: boolean;
  disponible?: boolean | null;
  enJornada?: boolean | null;
} | null;

export type ModeloConJefes = {
  id: string;
  jefeId: string | null;
  jefeSecundarioId: string | null;
  jefe?: JefeDeLaModelo;
  jefeSecundario?: JefeDeLaModelo;
};

/**
 * Si un jefe puede ver y atender los chats de una modelo.
 *
 * Todas las modelos son de agencia (ver CLAUDE.md): las atiende su jefe
 * principal o el secundario, y los dos ven siempre sus chats. Si ninguno puede
 * atender ahora (inactivo, no disponible o con la jornada cerrada), el chat no
 * puede quedarse sin nadie: pasa a cualquier jefe, como hacen
 * `ServicesService.create` y `findAssignedJefe` en Telegram con la asignacion
 * del servicio. La regla de "puede atender" es la misma `puedeAtender`.
 *
 * El admin ve todo y no pasa por aqui.
 */
export function jefeAlcanzaModelo(
  jefeId: string,
  modelo: ModeloConJefes,
): boolean {
  if (modelo.jefeId === jefeId || modelo.jefeSecundarioId === jefeId) {
    return true;
  }
  const atiende = (jefe: JefeDeLaModelo | undefined): boolean =>
    Boolean(jefe && jefe.activo && puedeAtender(jefe));
  return !atiende(modelo.jefe) && !atiende(modelo.jefeSecundario);
}
