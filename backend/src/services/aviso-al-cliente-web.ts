import { Logger } from '@nestjs/common';
import { quitarEmojis } from '../ai/ai-guardrails';
import { palabrasVetadasEn } from '../ai/vocabulario-vetado';
import { describeError } from '../common/errors/error-message';
import type { ConversationNotifier } from '../conversations/conversation-notifier';

/**
 * Avisos del ciclo de vida del servicio al chat web del cliente.
 *
 * El aviso se intenta siempre que el cliente tenga cuenta web (`usuarioId`), y
 * el notificador decide si hay una conversacion a la que mandarlo. Un cliente
 * sin cuenta web no cuesta nada: ni consulta ni llamada a la IA.
 */

/** Lo que hace falta del servicio para saber a quien y a que chat avisar. */
export type ServicioAvisable = {
  id: string;
  clienteId?: string | null;
  empleadaId?: string | null;
  cliente?: { usuarioId?: string | null } | null;
  /** Para nombrar a quien atiende en vez de decir "la empleada". */
  empleada?: { nombreArtistico?: string | null } | null;
};

export type OpcionesAvisoWeb = {
  /**
   * Texto fijo para cuando el principal, ya adaptado, sigue diciendo algo que
   * en la web no se dice. Sirve sobre todo para lo que redacta la IA, que no
   * escribe con el prompt web y puede soltar "la agencia" a su manera.
   */
  respaldo?: string;
};

/**
 * El texto de un aviso adaptado al chat web: sin emojis y sin las marcas de
 * Markdown, que la web mostraria como asteriscos sueltos.
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

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "quien te atiende" al principio de frase va con mayuscula. */
function conMayusculaSiHaceFalta(original: string, reemplazo: string): string {
  return /^[A-ZÁÉÍÓÚÑ]/.test(original)
    ? reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1)
    : reemplazo;
}

/**
 * Reescribe las formas conocidas de los textos de los avisos que en la web no
 * se dicen.
 *
 * Los avisos se escribieron hablando de "la empleada" y firmando
 * como "el asistente de la agencia". El prompt web le veta esas palabras a la
 * IA para que el cliente no vea la estructura interna, y un aviso que las
 * dijera a renglon seguido desharia esa politica. Aqui se arreglan las que se
 * pueden arreglar sin perder el dato: la presentacion sobra y a la persona se
 * la nombra por su nombre artistico, o como "quien te atiende" si no se sabe.
 */
export function textoConVocabularioWeb(
  texto: string,
  nombreArtistico?: string | null,
): string {
  const nombre = nombreArtistico?.trim() || null;
  let resultado = texto.replace(
    /\b(?:soy|te escribe)\s+(?:el|la)\s+asistente\s+de\s+la\s+agencia\s*[.,:;]?[ \t]*/gi,
    '',
  );
  if (nombre) {
    resultado = resultado.replace(
      new RegExp(
        `\\b[Ll]a\\s+(?:empleada|modelo)\\s+${escaparRegExp(nombre)}\\b`,
        'g',
      ),
      nombre,
    );
  }
  resultado = resultado.replace(/\b[Ll]a\s+(?:empleada|modelo)\b/g, (forma) =>
    conMayusculaSiHaceFalta(forma, nombre ?? 'quien te atiende'),
  );
  // Si se quito la presentacion, la frase que la seguia queda al principio.
  return resultado
    .split('\n')
    .map((linea) => {
      const limpia = linea.trim();
      return limpia.charAt(0).toUpperCase() + limpia.slice(1);
    })
    .join('\n')
    .trim();
}

/** Las frases de cada linea que no dicen nada vetado. */
function sinFrasesVetadas(texto: string): string {
  return texto
    .split('\n')
    .map((linea) =>
      linea
        .split(/(?<=[.!?])\s+/)
        .filter((frase) => palabrasVetadasEn(frase).length === 0)
        .join(' ')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * El texto final que se deja en el chat web: sin emojis, sin formato de
 * Markdown y sin ninguna de `PALABRAS_VETADAS_WEB`.
 *
 * Es la unica salida de los avisos hacia la web, asi que la garantia vale
 * para cualquier texto, tambien para el que redacte la IA. Por orden: el
 * principal adaptado; si sigue diciendo algo vetado, el respaldo adaptado; y
 * si tampoco, el principal sin las frases que lo dicen. Puede quedar vacio, y
 * entonces no se manda nada: es preferible a contarle al cliente lo que no
 * debe saber.
 */
export function textoWebSeguro(
  texto: string,
  nombreArtistico?: string | null,
  opciones: OpcionesAvisoWeb = {},
): string {
  const adaptar = (crudo: string) =>
    textoConVocabularioWeb(textoParaChatWeb(crudo), nombreArtistico);

  const principal = adaptar(texto);
  if (principal && palabrasVetadasEn(principal).length === 0) {
    return principal;
  }
  if (opciones.respaldo) {
    const respaldo = adaptar(opciones.respaldo);
    if (respaldo && palabrasVetadasEn(respaldo).length === 0) return respaldo;
  }
  return sinFrasesVetadas(principal);
}

/**
 * Cancelacion por demora en el chat web.
 *
 * No ofrece otras opciones ahora mismo: en la web no hay tarjetas para
 * contratar a otra; se le remite al catalogo, que es donde elige.
 */
export function textoAvisoCancelacionPorDemora(
  nombreArtistico: string | null | undefined,
): string {
  const quien = nombreArtistico || 'quien te iba a atender';
  return (
    `Servicio cancelado. Lamentamos informarte que ${quien} no pudo estar disponible a tiempo y el servicio ha sido cancelado.\n\n` +
    'Puedes elegir otra opción disponible desde el catálogo.'
  );
}

/**
 * Comparte una sola redaccion entre destinatarios: si ya se pidio el texto a
 * la IA, se reutiliza esa misma promesa en vez de pagar otra llamada y recibir
 * un mensaje distinto.
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
 *
 * El texto pasa siempre por `textoWebSeguro`: aqui se adapta, para que ningun
 * sitio pueda saltarse el filtro.
 */
export async function avisarAlChatWeb(
  notifier: ConversationNotifier | undefined,
  logger: Logger,
  servicio: ServicioAvisable,
  texto: string | (() => Promise<string>),
  opciones: OpcionesAvisoWeb = {},
): Promise<boolean> {
  if (!notifier || !servicio.clienteId || !servicio.cliente?.usuarioId) {
    return false;
  }
  try {
    const crudo = typeof texto === 'string' ? texto : await texto();
    const limpio = textoWebSeguro(
      crudo,
      servicio.empleada?.nombreArtistico,
      opciones,
    );
    if (!limpio) {
      logger.warn(
        `El aviso web del servicio ${servicio.id} no se mando: todo su texto decia algo que el cliente no debe leer`,
      );
      return false;
    }
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
