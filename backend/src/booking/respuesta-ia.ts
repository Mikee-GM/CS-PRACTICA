import {
  looksLikeAssistantRegister,
  pickDeflection,
  quitarEmojis,
  sanitizeAiReply,
  softenCommercialTone,
  stripFrontDeskOffer,
} from '../ai/ai-guardrails';
import type { CanalDeReserva } from './chat-channel';

/**
 * Lo que queda de una respuesta del modelo despues de los filtros de salida.
 *
 * `desvio` viene solo cuando la respuesta se sustituyo por un desvio en
 * personaje: quien llama lo guarda como ultimo desvio para no repetirlo en el
 * turno siguiente.
 */
export interface RespuestaVestida {
  texto: string;
  desvio: string | null;
  /** La respuesta traia algo util y aun asi se descarto (sonaba a asistente). */
  sustituida: boolean;
  /** Se le quito el ofrecimiento de mostrador ("¿en que te puedo ayudar?"). */
  quitoMostrador: boolean;
}

/**
 * Ultimo filtro sobre lo que redacta la IA antes de que lo lea el cliente:
 * quita marcas tecnicas, enlaces, arrobas y telefonos --lo que el prompt
 * promete pero no puede garantizar-- y sustituye la respuesta entera cuando
 * suena a asistente ("no puedo ayudarte con eso").
 *
 * Es la parte pura de `dressAiReply` de Telegram, que delega aqui y conserva
 * la cadencia de emojis, porque esa depende de su sesion.
 *
 * En la web cambian dos cosas. Declararse IA no descarta la respuesta (es la
 * contestacion honesta que se le pide), y los emojis se quitan ANTES de decidir
 * si queda algo: una respuesta que era solo emojis se queda vacia y se desvia,
 * en vez de salir en blanco.
 */
export function vestirRespuestaIa(
  respuesta: string,
  opciones: { canal?: CanalDeReserva; ultimoDesvio?: string | null } = {},
): RespuestaVestida {
  const web = opciones.canal === 'web';
  const saneado = softenCommercialTone(sanitizeAiReply(respuesta || ''));
  const sinMostrador = stripFrontDeskOffer(saneado);
  const quitoMostrador = sinMostrador !== saneado;
  const limpio = web ? quitarEmojis(sinMostrador).trim() : sinMostrador;

  if (
    !limpio ||
    looksLikeAssistantRegister(limpio, { permitirIdentidad: web })
  ) {
    const desvio = pickDeflection(
      opciones.ultimoDesvio,
      web ? 'web' : 'telegram',
    );
    return {
      texto: desvio,
      desvio,
      sustituida: Boolean(limpio),
      quitoMostrador,
    };
  }
  return { texto: limpio, desvio: null, sustituida: false, quitoMostrador };
}

const PIDE_DURACION =
  /\b(cu[aá]ntas?\s+horas?|cu[aá]nto\s+tiempo|qu[eé]\s+duraci[oó]n|no\s+alcanc[eé].{0,20}horas?)\b/i;

/**
 * Evita que una respuesta del modelo retroceda el formulario.
 *
 * Un cliente puede mandar dos mensajes cortos seguidos ("1 hr" y "bb") y el
 * segundo turno puede hacer que el modelo vuelva a preguntar por las horas. Con
 * la duracion ya guardada esa pregunta contradice el estado real, asi que se
 * cambia por la del paso siguiente.
 *
 * Devuelve el texto que la sustituye, o `null` si no hay nada que corregir.
 * `enforceBookingProgression` de Telegram delega aqui.
 */
export function corregirRetrocesoDeDuracion(
  texto: string,
  estado: { duracionFijada: boolean; ubicacionConfirmada: boolean },
): string | null {
  if (!estado.duracionFijada) return null;
  if (!PIDE_DURACION.test(texto)) return null;
  return estado.ubicacionConfirmada
    ? 'Perfecto mi cielo, ya tengo tu horita confirmada. ¿Cómo prefieres pagar, efectivo, tarjeta o transferencia?'
    : 'Perfecto mi cielo, ya tengo tu horita confirmada. ¿Te paso los moteles o me mandas tu pin?';
}

/**
 * Si una marca del modelo puede ejecutarse. Se exige que el cliente la haya
 * pedido de verdad y que quede cupo en la conversacion; asi, aunque el modelo
 * se deje convencer de escribirla, la accion no ocurre.
 *
 * Devuelve el motivo del rechazo para que cada canal lo registre a su manera.
 */
export function evaluarMarca(
  pedidaPorElCliente: boolean,
  dentroDelCupo: boolean,
): 'permitida' | 'no_pedida' | 'sin_cupo' {
  if (!pedidaPorElCliente) return 'no_pedida';
  if (!dentroDelCupo) return 'sin_cupo';
  return 'permitida';
}
