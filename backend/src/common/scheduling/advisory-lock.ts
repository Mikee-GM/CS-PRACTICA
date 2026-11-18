import { DataSource } from 'typeorm';

/**
 * Ejecuta `task` solo si este proceso consigue el advisory lock de Postgres.
 *
 * Los ciclos periodicos (recordatorios, retos, contenido semanal) no son
 * idempotentes: con dos replicas del backend cada ciclo se ejecutaba dos veces
 * y el destinatario recibia el mensaje duplicado. `pg_try_advisory_lock` es no
 * bloqueante, asi que la replica que no obtiene el lock se salta el turno en
 * vez de esperar.
 *
 * Se usa Postgres en vez de Redis porque ya es una dependencia del sistema.
 *
 * @returns true si esta replica ejecuto la tarea, false si otra la tenia.
 */
export async function withAdvisoryLock(
  dataSource: DataSource,
  lockKey: number,
  task: () => Promise<void>,
): Promise<boolean> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }]: Array<{ locked: boolean }> = await runner.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [lockKey],
    );
    if (!locked) return false;

    try {
      await task();
    } finally {
      // El lock es de sesion, no de transaccion: hay que soltarlo en la misma
      // conexion que lo tomo, pase lo que pase dentro de la tarea.
      await runner.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
    return true;
  } finally {
    await runner.release();
  }
}

/**
 * Igual que `withAdvisoryLock`, pero para un recurso concreto (una
 * conversacion, un cliente) y no para un ciclo global.
 *
 * Usa la forma de dos enteros de Postgres: `namespace` es la clave fija del
 * registro `ADVISORY_LOCKS` y el segundo entero sale de `hashtext(clave)`. Asi
 * cada recurso tiene su propio lock sin registrar una constante por recurso, y
 * el espacio de dos enteros no se pisa con el de un solo entero que usan los
 * ciclos. Dos claves distintas pueden compartir hash; quien lo use debe tratar
 * "no conseguido" como "reintenta luego", nunca como "ya esta hecho".
 *
 * Tambien es no bloqueante: esperar con `pg_advisory_lock` retendria una
 * conexion del pool por cada peticion en cola.
 *
 * @returns true si esta llamada ejecuto la tarea, false si el lock lo tenia otro.
 */
export async function withAdvisoryLockPorClave(
  dataSource: DataSource,
  namespace: number,
  clave: string,
  task: () => Promise<void>,
): Promise<boolean> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }]: Array<{ locked: boolean }> = await runner.query(
      'SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked',
      [namespace, clave],
    );
    if (!locked) return false;

    try {
      await task();
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [
        namespace,
        clave,
      ]);
    }
    return true;
  } finally {
    await runner.release();
  }
}

/**
 * Claves de los locks. Constantes explicitas para que dos ciclos distintos no
 * colisionen por accidente al derivarlas de un nombre.
 */
export const ADVISORY_LOCKS = {
  serviceSchedule: 811_001,
  challenges: 811_002,
  weeklyContent: 811_003,
  authCleanup: 811_005,
  workShiftReset: 811_006,
  waitTimeoutSweep: 811_007,
  serviceOperations: 811_008,
  // Antes estas dos se declaraban sueltas en sus archivos reutilizando 811_005 y
  // 811_006, de modo que authCleanup y workShiftReset se excluian con ellas.
  realtimeOutboxSweep: 811_009,
  // Namespace, no clave fija: se combina con el id de cada conversacion en
  // `withAdvisoryLockPorClave` para que nunca corran dos turnos de la IA a la
  // vez sobre la misma conversacion, tampoco entre replicas.
  conversationTurn: 811_011,
  onboardingWebReminders: 811_021,
} as const;
