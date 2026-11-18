/*
 * Este archivo no declara ni importa modulos de Nest: lo usan el chat web y los
 * posts (B5) sin que `PostsModule` dependa de `ConversationsModule`. Solo
 * importa tipos y la regla pura de `puedeAtender`.
 */
import type { Repository } from 'typeorm';
import type { Empleadas } from '../employees/entities/employee.entity';
import { puedeAtender } from '../services/puede-atender';
import type { Usuarios } from '../users/entities/user.entity';

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
 * `ServicesService.create` y `findAssignedJefe` con la asignacion
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

/** Lo unico que hace falta saber de quien pregunta. */
export type ActorDelEquipo = Pick<Usuarios, 'id' | 'rol'>;

/**
 * Modelos que le tocan a quien pregunta: `null` para el admin (todas); para un
 * jefe, la lista de ids; para cualquier otro rol, ninguna. Carga todas las
 * modelos con sus dos jefes y filtra en memoria porque la regla de relevo
 * (`puedeAtender`) no se expresa en SQL sin duplicarla.
 */
export async function modelosAlAlcance(
  empleadas: Repository<Empleadas>,
  actor: ActorDelEquipo,
): Promise<string[] | null> {
  if (actor.rol === 'admin') return null;
  if (actor.rol !== 'jefe') return [];
  const modelos = await empleadas.find({
    select: {
      id: true,
      jefeId: true,
      jefeSecundarioId: true,
      jefe: { id: true, activo: true, disponible: true, enJornada: true },
      jefeSecundario: {
        id: true,
        activo: true,
        disponible: true,
        enJornada: true,
      },
    },
    relations: { jefe: true, jefeSecundario: true },
  });
  return modelos
    .filter((modelo) => jefeAlcanzaModelo(actor.id, modelo))
    .map((modelo) => modelo.id);
}

/**
 * Si una modelo concreta existe y le toca a quien pregunta. El admin alcanza
 * cualquiera que exista; una modelo inexistente responde igual que una ajena,
 * para que quien llama conteste 404 en ambos casos.
 */
export async function modeloAlAlcance(
  empleadas: Repository<Empleadas>,
  actor: ActorDelEquipo,
  employeeId: string,
): Promise<boolean> {
  if (actor.rol !== 'admin' && actor.rol !== 'jefe') return false;
  const modelo = await empleadas.findOne({
    where: { id: employeeId },
    relations: { jefe: true, jefeSecundario: true },
  });
  if (!modelo) return false;
  return actor.rol === 'admin' || jefeAlcanzaModelo(actor.id, modelo);
}
