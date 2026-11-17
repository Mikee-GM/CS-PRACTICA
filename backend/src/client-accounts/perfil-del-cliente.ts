import { DataSource, EntityManager } from 'typeorm';

/**
 * Por debajo de este numero de calificaciones el promedio no se muestra: con
 * una o dos notas basta una mala para hundirlo, y el cliente veria un numero
 * volatil e injusto. La cantidad si se devuelve, para que la interfaz pueda
 * decir cuantas faltan.
 */
export const MINIMO_DE_CALIFICACIONES = 3;

export type CalificacionDelCliente = {
  promedio: number | null;
  cantidad: number;
};

type Consultor = Pick<DataSource | EntityManager, 'query'>;

/**
 * Calificacion que las modelos le han dado al cliente.
 *
 * Es el mismo criterio que `DisciplineService.ratingSummary`: una nota en
 * apelacion (`pending`) o anulada (`overturned`) no cuenta. La consulta del
 * dossier no filtra apelaciones y por eso no se reutiliza aqui.
 */
export async function calificacionDelCliente(
  db: Consultor,
  clienteId: string,
): Promise<CalificacionDelCliente> {
  const filas: { promedio: number | null; cantidad: number }[] = await db.query(
    `SELECT ROUND(AVG(stars)::numeric, 2)::float AS "promedio",
              COUNT(*)::int AS "cantidad"
         FROM interaction_ratings
        WHERE client_id = $1
          AND direction = 'employee_to_client'
          AND appeal_status NOT IN ('pending', 'overturned')`,
    [clienteId],
  );
  const cantidad = Number(filas[0]?.cantidad ?? 0);
  const promedio = filas[0]?.promedio ?? null;
  return {
    promedio:
      cantidad >= MINIMO_DE_CALIFICACIONES && promedio !== null
        ? Number(promedio)
        : null,
    cantidad,
  };
}

/** Mismo conteo de finalizados que el dossier del cliente. */
export async function serviciosFinalizados(
  db: Consultor,
  clienteId: string,
): Promise<number> {
  const filas: { finalizados: number }[] = await db.query(
    `SELECT COUNT(*) FILTER (WHERE estado = 'finalizado')::int AS "finalizados"
       FROM servicios
      WHERE cliente_id = $1 AND deleted_at IS NULL`,
    [clienteId],
  );
  return Number(filas[0]?.finalizados ?? 0);
}

/**
 * Si el cliente tiene ahora mismo una sancion que lo restringe.
 *
 * Se consulta la tabla directamente en vez de inyectar `DisciplineService`:
 * `DisciplineModule` arrastra `TelegramModule`, que acaba importando
 * `AuthModule`, y este importa `ClientAccountsModule`; inyectarlo cerraria un
 * ciclo. Ademas `getActiveSanction` ejecuta antes `expireSanctions`, que
 * escribe y emite eventos, y una lectura de perfil no debe tener efectos.
 * Las condiciones son las mismas que las suyas: una suspension cuyo
 * `ends_at` ya paso no cuenta aunque siga marcada `active`.
 */
export async function tieneSancionVigente(
  db: Consultor,
  clienteId: string,
): Promise<boolean> {
  const filas: { vigente: boolean }[] = await db.query(
    `SELECT EXISTS (
       SELECT 1
         FROM disciplinary_sanctions
        WHERE subject_type = 'client'
          AND subject_id = $1
          AND status = 'active'
          AND starts_at <= now()
          AND (
            type = 'permanent_ban'
            OR (type = 'suspension' AND ends_at > now())
          )
     ) AS "vigente"`,
    [clienteId],
  );
  return filas[0]?.vigente === true;
}
