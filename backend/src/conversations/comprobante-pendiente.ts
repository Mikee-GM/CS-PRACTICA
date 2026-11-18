import { comprobanteEnCurso } from '../booking/booking-receipts';
import { normalizarEstado } from '../booking/booking-state';
import { toCents } from '../common/money';
import type { ConversationStatus } from './entities/conversation.entity';

/**
 * Cuando una conversacion web admite un comprobante de transferencia.
 *
 * Es un solo criterio para tres sitios: la subida del comprobante
 * (`ConversationReceiptsService`, que responde 409 si no se cumple), el
 * resumen del cliente (`comprobantePendiente`, para mostrar o esconder el
 * boton) y la bandeja del equipo. Si estuvieran copiados, el boton podria
 * ofrecer una subida que el servidor rechaza.
 */

/** Metodos de pago cuyo cobro se acredita con comprobante. */
export const METODOS_CON_COMPROBANTE = ['transferencia', 'mixto'] as const;

/** Estados de un servicio que ya no admiten comprobante. */
export const SERVICIO_CERRADO = ['cancelado', 'finalizado'] as const;

/**
 * Cuanto se considera vivo un analisis en `PROCESANDO`. El analizador corta a los 60 s, asi que tres minutos solo los
 * pasa un analisis que se quedo colgado.
 */
export const VENTANA_ANALISIS_MS = 3 * 60 * 1000;

/**
 * Hay un cobro esperando comprobante: la reserva que el turno de la IA dejo
 * "esperando comprobante" o un servicio por transferencia que sigue con la
 * marca de comprobante pendiente (`servicioLoEspera`, que decide quien lee el
 * servicio con `METODOS_CON_COMPROBANTE` y `SERVICIO_CERRADO`).
 */
export function hayCobroPendiente(
  estadoGuardado: unknown,
  servicioLoEspera: boolean,
): boolean {
  return (
    Boolean(normalizarEstado(estadoGuardado).esperandoComprobante) ||
    servicioLoEspera
  );
}

export interface SituacionDelComprobante {
  status: ConversationStatus;
  /** `conversations.state` tal como esta guardado. */
  estado: unknown;
  servicioLoEspera: boolean;
  /** El ultimo comprobante de la conversacion, si hay alguno. */
  ultimoComprobante: { estado?: string | null; createdAt: Date } | null;
}

/**
 * El cliente puede mandar un comprobante ahora: la conversacion sigue abierta,
 * hay un cobro pendiente y no hay otro comprobante en analisis, en revision o
 * aprobado (no tiene que mandarlo dos veces).
 */
export function admiteComprobante(
  situacion: SituacionDelComprobante,
  ahora: number = Date.now(),
): boolean {
  if (situacion.status === 'cerrada') return false;
  if (!hayCobroPendiente(situacion.estado, situacion.servicioLoEspera)) {
    return false;
  }
  return !comprobanteEnCurso(
    situacion.ultimoComprobante
      ? {
          estado: situacion.ultimoComprobante.estado ?? undefined,
          createdAt: situacion.ultimoComprobante.createdAt,
        }
      : null,
    VENTANA_ANALISIS_MS,
    ahora,
  );
}

/**
 * El servicio de la conversacion espera comprobante (ya filtrado por metodo y
 * por estado abierto con `METODOS_CON_COMPROBANTE` y `SERVICIO_CERRADO`).
 *
 * Un servicio individual lo dice con `comprobante_pendiente`. Uno grupal no
 * usa esa marca: lo que espera es su saldo (`pending_balance`, que calcula el
 * trigger `calcular_total_servicio`), y solo por transferencia, que es el unico
 * metodo grupal que se acredita con CEP (`GroupServicesService.registerPayment`).
 * Una ampliacion del grupo vuelve a abrir saldo y, con el, el comprobante.
 */
export function servicioEsperaComprobante(servicio: {
  serviceType?: string | null;
  metodoPago?: string | null;
  comprobantePendiente?: boolean | null;
  pendingBalance?: number | string | null;
}): boolean {
  if (servicio.serviceType === 'grupal') {
    return (
      servicio.metodoPago === 'transferencia' &&
      toCents(servicio.pendingBalance) > 0
    );
  }
  return Boolean(servicio.comprobantePendiente);
}

/**
 * Fragmentos SQL para leer lo mismo en una consulta de listado. `$m` y `$s`
 * son los parametros con `METODOS_CON_COMPROBANTE` y `SERVICIO_CERRADO`. La
 * condicion es la de `servicioEsperaComprobante`.
 */
export function joinServicioQueEsperaComprobante(
  alias: string,
  conversacion: string,
  parametroMetodos: string,
  parametroCerrados: string,
): string {
  return `LEFT JOIN servicios ${alias}
         ON ${alias}.id = ${conversacion}.service_id
        AND ${alias}.metodo_pago::text = ANY(${parametroMetodos}::text[])
        AND (
          (${alias}.service_type <> 'grupal'
           AND ${alias}.comprobante_pendiente = true)
          OR (${alias}.service_type = 'grupal'
              AND ${alias}.metodo_pago::text = 'transferencia'
              AND ${alias}.pending_balance > 0)
        )
        AND ${alias}.estado::text <> ALL(${parametroCerrados}::text[])`;
}

/** El ultimo comprobante de la conversacion, como en la subida. */
export function lateralUltimoComprobante(
  alias: string,
  conversacion: string,
): string {
  return `LEFT JOIN LATERAL (
         SELECT v.estado, v.created_at, v.pago_confirmado_at
         FROM messages rm
         INNER JOIN payment_receipt_validations v
                 ON v.id = rm.receipt_validation_id
         WHERE rm.conversation_id = ${conversacion}.id
         ORDER BY rm.created_at DESC, rm.id DESC
         LIMIT 1
       ) ${alias} ON true`;
}
