import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/locale";

/**
 * Tipos y reglas puras del chat web del cliente.
 *
 * Vive aparte de los componentes para poder probar sin DOM lo que de verdad
 * decide algo: como se mezclan los mensajes que llegan por tres caminos
 * distintos (la primera pagina del servidor, las paginas antiguas y los
 * optimistas que pinta el propio navegador) y cuando se ofrece subir un
 * comprobante. Un error aqui se ve como un mensaje duplicado o perdido.
 */

export type EstadoConversacion =
  | "activa"
  | "en_revision"
  | "con_servicio"
  | "cerrada";

export type Remitente = "cliente" | "ia" | "jefe" | "sistema";

export type AdjuntoDelChat = {
  type: "comprobante" | "foto" | "ubicacion";
  url?: string;
};

export type MensajeDelChat = {
  id: string;
  conversationId: string;
  sender: Remitente;
  body: string;
  attachment: AdjuntoDelChat | null;
  clientMessageId: string | null;
  createdAt: string;
};

export type ModeloDelChat = {
  id: string;
  nombreArtistico: string;
  slugCatalogo: string;
  fotoPerfilUrl: string | null;
};

export type ResumenDeConversacion = {
  id: string;
  status: EstadoConversacion;
  lastMessageAt: string | null;
  createdAt: string;
  employee: ModeloDelChat;
  lastMessage: {
    id: string;
    sender: Remitente;
    preview: string;
    hasAttachment: boolean;
    createdAt: string;
  } | null;
};

export type PaginaDeMensajes = {
  items: MensajeDelChat[];
  nextCursor: string | null;
};

export type UbicacionDelMensaje = { lat: number; lng: number; address?: string };

/** Resultado del analisis de un comprobante, segun el evento `receipt_status`. */
export type EstadoDelComprobante = "recibido" | "en_revision" | "rechazado" | "error";

export const ESTADOS_DEL_COMPROBANTE: readonly EstadoDelComprobante[] = [
  "recibido",
  "en_revision",
  "rechazado",
  "error",
];

/**
 * Un mensaje tal como se pinta. Los optimistas llevan `envio`: existen solo en
 * este navegador hasta que el servidor devuelve su version con id real.
 */
export type MensajeEnPantalla = MensajeDelChat & {
  envio?: "enviando" | "error";
  /** Lo que hay que volver a mandar si el envio falla. */
  reintento?: { body?: string; location?: UbicacionDelMensaje };
};

/** Prefijo de los ids provisionales; nunca coincide con un uuid del backend. */
const PREFIJO_LOCAL = "local:";

export function esOptimista(mensaje: MensajeEnPantalla): boolean {
  return mensaje.id.startsWith(PREFIJO_LOCAL);
}

export function crearOptimista(datos: {
  conversationId: string;
  clientMessageId: string;
  body?: string;
  location?: UbicacionDelMensaje;
  ahora?: Date;
}): MensajeEnPantalla {
  return {
    id: `${PREFIJO_LOCAL}${datos.clientMessageId}`,
    conversationId: datos.conversationId,
    sender: "cliente",
    // Sin texto, la burbuja ya rotula el adjunto de ubicacion.
    body: datos.body ?? datos.location?.address ?? "",
    attachment: datos.location ? { type: "ubicacion" } : null,
    clientMessageId: datos.clientMessageId,
    createdAt: (datos.ahora ?? new Date()).toISOString(),
    envio: "enviando",
    reintento: { body: datos.body, location: datos.location },
  };
}

function compararCronologico(a: MensajeDelChat, b: MensajeDelChat): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  // Mismo instante: el id desempata igual que el cursor del backend, que
  // ordena por `(created_at, id)`.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Mezcla lo que ya hay en pantalla con mensajes del servidor, en cualquier
 * orden de llegada (la API entrega del mas nuevo al mas antiguo).
 *
 * Reglas:
 *  - Un id del servidor aparece una sola vez; la version nueva gana.
 *  - Un optimista desaparece en cuanto llega del servidor un mensaje con su
 *    `clientMessageId`: es el mismo mensaje ya confirmado. Si se quedara, el
 *    cliente veria su texto dos veces cuando el evento en vivo llega antes que
 *    la respuesta del envio.
 *  - Los confirmados van en orden cronologico y los optimistas pendientes
 *    siempre al final, en el orden en que se escribieron: su hora sale del
 *    reloj del telefono, que puede ir adelantado o atrasado respecto al
 *    servidor, y no debe colarlos entre mensajes ya confirmados.
 */
export function mezclarMensajes(
  actuales: readonly MensajeEnPantalla[],
  delServidor: readonly MensajeDelChat[],
): MensajeEnPantalla[] {
  const confirmados = new Map<string, MensajeEnPantalla>();
  const pendientes: MensajeEnPantalla[] = [];

  for (const mensaje of actuales) {
    if (esOptimista(mensaje)) pendientes.push(mensaje);
    else confirmados.set(mensaje.id, mensaje);
  }
  for (const mensaje of delServidor) confirmados.set(mensaje.id, mensaje);

  const confirmadosPorCliente = new Set(
    [...confirmados.values()]
      .map((m) => m.clientMessageId)
      .filter((id): id is string => Boolean(id)),
  );

  return [
    ...[...confirmados.values()].sort(compararCronologico),
    ...pendientes.filter(
      (m) => !m.clientMessageId || !confirmadosPorCliente.has(m.clientMessageId),
    ),
  ];
}

/** Cambia el estado de envio de un optimista; los demas quedan igual. */
export function marcarEnvio(
  mensajes: readonly MensajeEnPantalla[],
  clientMessageId: string,
  envio: "enviando" | "error",
): MensajeEnPantalla[] {
  return mensajes.map((m) =>
    esOptimista(m) && m.clientMessageId === clientMessageId
      ? { ...m, envio }
      : m,
  );
}

/** Id del mensaje confirmado mas antiguo: el cursor para pedir la pagina previa. */
export function cursorMasAntiguo(
  mensajes: readonly MensajeEnPantalla[],
): string | null {
  return mensajes.find((m) => !esOptimista(m))?.id ?? null;
}

/**
 * ¿La pagina recien pedida llega hasta algo que ya teniamos?
 *
 * Tras un aviso en vivo se pide la pagina mas reciente. Si ninguno de sus ids
 * era conocido, entre ella y lo que hay en pantalla puede haber mas mensajes
 * (la conexion estuvo caida un rato) y hay que seguir pidiendo hacia atras.
 */
export function enlazaConLoConocido(
  conocidos: readonly MensajeEnPantalla[],
  pagina: readonly MensajeDelChat[],
): boolean {
  if (conocidos.every(esOptimista)) return true;
  const ids = new Set(conocidos.map((m) => m.id));
  return pagina.some((m) => ids.has(m.id));
}

/** Quita acentos y mayusculas para buscar palabras sin depender de la redaccion. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** ¿Este aviso del sistema pide el comprobante de pago? */
export function pideComprobante(mensaje: MensajeDelChat): boolean {
  return mensaje.sender === "sistema" && normalizar(mensaje.body).includes("comprobante");
}

/**
 * Regla para ofrecer la subida del comprobante.
 *
 * El backend no expone si la reserva espera un comprobante, asi que se deduce
 * de la conversacion: se muestra cuando la conversacion no esta cerrada y el
 * ultimo aviso del sistema que menciona el comprobante es posterior al ultimo
 * comprobante que mando el cliente. Asi aparece en cuanto se pide, desaparece
 * al enviarlo y vuelve si el equipo lo rechaza y lo pide otra vez.
 *
 * Tambien vuelve si el analisis de ese ultimo comprobante salio `rechazado` o
 * `error` (evento `receipt_status`): el backend no garantiza un aviso de texto
 * en ese caso, y sin esto el cliente se quedaria sin forma de mandar otro. Ese
 * estado solo vive en esta pestaña; al recargar cuenta el texto.
 *
 * No basta con el estado `en_revision`: tambien se llega ahi pagando en
 * efectivo, y ofrecer el comprobante a quien no tiene nada que comprobar solo
 * acabaria en un 409 del servidor.
 */
export function debeMostrarComprobante(
  status: EstadoConversacion,
  mensajes: readonly MensajeEnPantalla[],
  analisis: Readonly<Record<string, EstadoDelComprobante>> = {},
): boolean {
  if (status === "cerrada") return false;
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i];
    if (mensaje.sender === "cliente" && mensaje.attachment?.type === "comprobante") {
      const resultado = analisis[mensaje.id];
      return resultado === "rechazado" || resultado === "error";
    }
    if (pideComprobante(mensaje)) return true;
  }
  return false;
}

const ETIQUETAS_DE_ESTADO: Record<EstadoConversacion, string> = {
  activa: "Activa",
  en_revision: "En revisión",
  con_servicio: "Servicio en curso",
  cerrada: "Cerrada",
};

export function etiquetaDeEstado(status: EstadoConversacion): string {
  return ETIQUETAS_DE_ESTADO[status] ?? status;
}

/** Hora del mensaje en la zona del negocio, nunca en la del telefono. */
export function horaDelMensaje(iso: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Hora corta para la bandeja: la hora si es de hoy, la fecha si no. "Hoy" se
 * mide en la zona del negocio.
 */
export function momentoCorto(iso: string, ahora: Date = new Date()): string {
  const dia = (fecha: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(fecha);
  const fecha = new Date(iso);
  if (dia(fecha) === dia(ahora)) return horaDelMensaje(iso);
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
  }).format(fecha);
}

/** Texto de la vista previa en la bandeja, con el adjunto si no hay texto. */
export function vistaPrevia(resumen: ResumenDeConversacion): string {
  const ultimo = resumen.lastMessage;
  if (!ultimo) return "Aún no hay mensajes. Escribe para empezar.";
  const texto = ultimo.preview.trim() || (ultimo.hasAttachment ? "Archivo adjunto" : "");
  return ultimo.sender === "cliente" ? `Tú: ${texto}` : texto;
}
