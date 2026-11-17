import { Logger } from '@nestjs/common';
import { quitarEmojis } from '../ai/ai-guardrails';
import { describeError } from '../common/errors/error-message';
import type { ConversationNotifier } from '../conversations/conversation-notifier';

/**
 * Avisos del ciclo de vida del servicio al chat web del cliente.
 *
 * Criterio de canales: cada aviso sale por todos los que el cliente tiene, una
 * vez por canal. El de Telegram no cambia; el web se intenta siempre que el
 * cliente tenga cuenta web (`usuarioId`), y el notificador decide si hay una
 * conversacion a la que mandarlo. Un cliente de Telegram sin cuenta web no
 * cuesta nada mas: ni consulta ni llamada a la IA.
 */

/** Lo que hace falta del servicio para saber a quien y a que chat avisar. */
export type ServicioAvisable = {
  id: string;
  clienteId?: string | null;
  empleadaId?: string | null;
  cliente?: { usuarioId?: string | null } | null;
};

/**
 * El texto de Telegram adaptado al chat web: sin emojis y sin las marcas de
 * Markdown de Telegram, que la web mostraria como asteriscos sueltos.
 */
export function textoParaChatWeb(texto: string): string {
  // Linea a linea: `quitarEmojis` recompone los espacios de todo el texto y
  // juntaria los parrafos que la cuenta final separa con una linea en blanco.
  return texto
    .split('\n')
    .map((linea) =>
      quitarEmojis(linea)
        .replace(/[*`]/g, '')
        .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:!?])/g, '$1$2')
        .replace(/[ \t]+/g, ' ')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cancelacion por demora en el chat web.
 *
 * Es el texto de Telegram sin su formato y sin la invitacion a "ver otras
 * opciones ahora mismo": en Telegram la siguen tarjetas con botones para
 * contratar a otra, y en la web esas tarjetas no existen; se le remite al
 * catalogo, que es donde elige.
 */
export function textoAvisoCancelacionPorDemora(
  nombreArtistico: string | null | undefined,
): string {
  const quien = nombreArtistico
    ? `la empleada ${nombreArtistico}`
    : 'la empleada';
  return (
    `Servicio cancelado. Lamentamos informarte que ${quien} no pudo estar disponible a tiempo y el servicio ha sido cancelado.\n\n` +
    'Puedes elegir otra opción disponible desde el catálogo.'
  );
}

/**
 * Comparte una sola redaccion entre canales: si Telegram ya pidio el texto a
 * la IA, la web reutiliza esa misma promesa en vez de pagar otra llamada y
 * recibir un mensaje distinto.
 */
export function unaVez<T>(producir: () => Promise<T>): () => Promise<T> {
  let resultado: Promise<T> | null = null;
  return () => (resultado ??= producir());
}

/**
 * Deja el aviso en el chat web si el cliente tiene cuenta web. Nunca lanza:
 * el servicio ya cambio de estado y un aviso que falla no lo deshace.
 *
 * El notificador puede faltar porque es opcional en quien lo inyecta (ver
 * `ServicesService`); sin el no hay canal web y se sigue.
 */
export async function avisarAlChatWeb(
  notifier: ConversationNotifier | undefined,
  logger: Logger,
  servicio: ServicioAvisable,
  texto: string | (() => Promise<string>),
): Promise<boolean> {
  if (!notifier || !servicio.clienteId || !servicio.cliente?.usuarioId) {
    return false;
  }
  try {
    const crudo = typeof texto === 'string' ? texto : await texto();
    const limpio = textoParaChatWeb(crudo);
    if (!limpio) return false;
    return await notifier.notifyClient({
      clienteId: servicio.clienteId,
      serviceId: servicio.id,
      employeeId: servicio.empleadaId ?? null,
      texto: limpio,
    });
  } catch (error) {
    logger.error(
      `No se pudo avisar por el chat web al cliente del servicio ${servicio.id}: ${describeError(error)}`,
    );
    return false;
  }
}
