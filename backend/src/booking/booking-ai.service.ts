import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiProviderService } from '../ai/ai-provider.service';
import { Clientes } from '../clients/entities/client.entity';
import { APP_TIME_ZONE } from '../common/locale';
import { LimiteDiarioDeIaError } from './booking.errors';

/** Historial en el formato que ya usa la conversacion de reserva. */
export type HistorialDeReserva = {
  role: 'user' | 'model';
  parts: { text: string }[];
}[];

export interface OpcionesDeLlamadaIa {
  /** Cliente al que se le cuenta la llamada; sin el, no se cuenta nada. */
  clienteId?: string;
  /**
   * Si se hace cumplir `MAX_DAILY_AI_CALLS`. Por defecto si.
   *
   * Telegram lo desactiva a proposito: hasta ahora el limite solo se declaraba
   * y nunca se aplicaba, y cortarle la IA a un cliente de Telegram a media
   * conversacion es un cambio de comportamiento que esta fase no pretende.
   * Para Telegram solo se sigue contando.
   */
  aplicarLimiteDiario?: boolean;
}

const LIMITE_DIARIO_POR_DEFECTO = 15;

/**
 * Llamada al modelo de la conversacion de reserva, independiente del canal.
 *
 * Identifica al cliente por su id y no por su chat de Telegram, porque un
 * cliente web no tiene chat. Cuenta cada llamada en `clientes` y, en los
 * canales que lo aplican, corta al pasar del limite diario antes de gastar
 * una llamada al proveedor.
 */
@Injectable()
export class BookingAiService {
  private readonly logger = new Logger(BookingAiService.name);

  constructor(
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    private readonly aiProviderService: AiProviderService,
    private readonly configService: ConfigService,
  ) {}

  async callModel(
    systemPrompt: string,
    history: HistorialDeReserva,
    opciones: OpcionesDeLlamadaIa = {},
  ): Promise<string> {
    if (opciones.clienteId) {
      await this.registrarLlamada(
        opciones.clienteId,
        opciones.aplicarLimiteDiario ?? true,
      );
    }

    const formattedHistory = history.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.parts?.[0]?.text || '',
    }));

    return this.aiProviderService.generateChatResponse(
      systemPrompt,
      formattedHistory,
    );
  }

  private limiteDiario(): number {
    const configurado = Number(
      this.configService.get<number>('MAX_DAILY_AI_CALLS'),
    );
    return Number.isFinite(configurado) && configurado > 0
      ? configurado
      : LIMITE_DIARIO_POR_DEFECTO;
  }

  /**
   * Suma la llamada al contador del dia, o lanza `LimiteDiarioDeIaError` si
   * ya no queda cupo.
   *
   * Comprobar y sumar van en una sola sentencia: leer, comparar y guardar
   * desde aqui dejaba que dos mensajes simultaneos del mismo cliente vieran
   * el mismo contador y se colaran los dos por encima del limite. El dia se
   * corta a medianoche de Mexico, la hora del negocio, no la del servidor.
   *
   * Un fallo de la base al contar no bloquea la conversacion: se registra y se
   * sigue, igual que hacia el contador de Telegram. Lo unico que corta es el
   * limite alcanzado.
   */
  private async registrarLlamada(
    clienteId: string,
    aplicarLimite: boolean,
  ): Promise<void> {
    const limite = aplicarLimite ? this.limiteDiario() : null;

    let fila: { llamadas: number | null; existe: boolean } | undefined;
    try {
      const filas: { llamadas: number | null; existe: boolean }[] =
        await this.clientesRepository.query(
          `WITH actual AS (
             SELECT c.id,
                    (c.last_ai_call_at IS NOT NULL
                     AND (c.last_ai_call_at AT TIME ZONE $3)::date
                         = (now() AT TIME ZONE $3)::date) AS mismo_dia
               FROM public.clientes c
              WHERE c.id = $1
           ),
           actualizado AS (
             UPDATE public.clientes c
                SET ai_calls_today = CASE WHEN actual.mismo_dia
                                          THEN COALESCE(c.ai_calls_today, 0) + 1
                                          ELSE 1 END,
                    last_ai_call_at = now()
               FROM actual
              WHERE c.id = actual.id
                AND ($2::int IS NULL
                     OR NOT actual.mismo_dia
                     OR COALESCE(c.ai_calls_today, 0) < $2::int)
             RETURNING c.ai_calls_today
           )
           SELECT (SELECT ai_calls_today FROM actualizado) AS llamadas,
                  EXISTS (SELECT 1 FROM actual) AS existe`,
          [clienteId, limite, APP_TIME_ZONE],
        );
      fila = filas?.[0];
    } catch (err) {
      this.logger.warn('Error registrando llamada de IA para el cliente:', err);
      return;
    }

    if (limite !== null && fila?.existe && fila.llamadas === null) {
      throw new LimiteDiarioDeIaError(clienteId, limite);
    }
  }
}
