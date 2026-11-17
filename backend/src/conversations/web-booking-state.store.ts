import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConflictoDeVersionError } from '../booking/booking.errors';
import { normalizarEstado, type BookingState } from '../booking/booking-state';
import type {
  BookingStateStore,
  ConversationRef,
} from '../booking/chat-channel';

/**
 * Estado de la reserva web, guardado en `conversations.state` con
 * `state_version` como version optimista.
 *
 * El turno de la IA ya corre en exclusiva por conversacion (advisory lock),
 * pero el estado lo puede tocar tambien un jefe desde el panel. Sin version, el
 * ultimo en guardar pisaria en silencio lo que decidio el otro.
 */
@Injectable()
export class WebBookingStateStore implements BookingStateStore<BookingState> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async load(
    ref: ConversationRef,
  ): Promise<{ state: BookingState; version: number } | null> {
    const filas: Array<{ state: unknown; state_version: number }> =
      await this.dataSource.query(
        'SELECT state, state_version FROM conversations WHERE id = $1',
        [conversacionDe(ref)],
      );
    const fila = filas[0];
    if (!fila) return null;
    return {
      state: normalizarEstado(fila.state),
      version: Number(fila.state_version),
    };
  }

  /**
   * Compara y escribe en la misma sentencia; leer la version y despues
   * actualizar dejaria un hueco entre las dos. Va en una CTE porque un
   * `UPDATE ... RETURNING` suelto devuelve `[filas, cuenta]` en el driver de pg.
   */
  async save(
    ref: ConversationRef,
    state: BookingState,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    const id = conversacionDe(ref);
    const filas: Array<{ state_version: number }> = await this.dataSource.query(
      `WITH actualizada AS (
         UPDATE conversations
            SET state = $2::jsonb,
                state_version = state_version + 1,
                updated_at = now()
          WHERE id = $1 AND state_version = $3
         RETURNING state_version
       )
       SELECT state_version FROM actualizada`,
      [id, JSON.stringify(state), expectedVersion],
    );
    if (filas[0]) return { version: Number(filas[0].state_version) };

    const actual: Array<{ state_version: number }> =
      await this.dataSource.query(
        'SELECT state_version FROM conversations WHERE id = $1',
        [id],
      );
    throw new ConflictoDeVersionError(
      expectedVersion,
      actual[0] ? Number(actual[0].state_version) : null,
    );
  }
}

function conversacionDe(ref: ConversationRef): string {
  if (!ref.conversationId) {
    throw new Error(
      'El estado de la reserva web necesita el id de la conversacion.',
    );
  }
  return ref.conversationId;
}
