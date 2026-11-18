import {
  normalizar,
  type EstadoConversacion,
  type MensajeDelChat,
  type Remitente,
} from "@/lib/conversaciones";

/**
 * Tipos y reglas puras del chat web visto por el equipo (jefes y admins).
 *
 * Aparte de los componentes por lo mismo que `conversaciones.ts`: lo que
 * decide algo --que botones se ofrecen segun quien tiene el control, que se
 * recarga con cada evento en vivo, como se traduce un 409-- se prueba sin DOM.
 * Un error aqui se ve como un boton que acaba en 409 o, peor, como una
 * respuesta escrita que no llega a nadie.
 */

export type ModoConversacion = "AI_ACTIVE" | "HUMAN_ACTIVE";

export type MotivoDeAtencion =
  | "entregada_al_equipo"
  | "en_revision"
  | "comprobante_en_revision"
  | "fallos_ia"
  | "cliente_sin_respuesta";

export type ConversacionDelEquipo = {
  id: string;
  status: EstadoConversacion;
  mode: ModoConversacion;
  humanOwnerId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  bookingSessionId: string | null;
  serviceId: string | null;
  employee: { id: string; nombreArtistico: string; fotoPerfilUrl: string | null };
  client: { id: string; nombre: string };
  lastMessage: {
    id: string;
    sender: Remitente;
    preview: string;
    hasAttachment: boolean;
    createdAt: string;
  } | null;
  requiereAtencion: boolean;
  motivosDeAtencion: MotivoDeAtencion[];
  comprobanteEnRevision: boolean;
  comprobantePendiente: boolean;
};

/** Mensaje visto por el equipo: el pin trae coordenadas y el comprobante su validacion. */
export type MensajeParaElEquipo = Omit<MensajeDelChat, "attachment"> & {
  attachment: {
    type: "comprobante" | "foto" | "ubicacion";
    url?: string;
    lat?: number;
    lng?: number;
    address?: string;
  } | null;
  receiptValidationId: string | null;
};

export type PaginaDelEquipo = {
  items: MensajeParaElEquipo[];
  nextCursor: string | null;
};

export type ControlDeConversacion = {
  conversationId: string;
  mode: ModoConversacion;
  humanOwnerId: string | null;
  humanTakenAt: string | null;
};

export type DecisionSobreBorrador = {
  conversationId: string;
  status: EstadoConversacion;
  bookingSessionId: string | null;
  serviceId: string | null;
  idempotent: boolean;
};

export type UsuarioDelPanel = { id: string; rol: "admin" | "jefe" };

// ----------------------------------------------------------------- etiquetas

const ETIQUETAS_DE_MOTIVO: Record<MotivoDeAtencion, string> = {
  entregada_al_equipo: "Pide atención del equipo",
  en_revision: "Solicitud por revisar",
  comprobante_en_revision: "Comprobante por revisar",
  fallos_ia: "La IA no pudo responder",
  cliente_sin_respuesta: "Cliente sin respuesta",
};

export function etiquetaDeMotivo(motivo: MotivoDeAtencion): string {
  return ETIQUETAS_DE_MOTIVO[motivo] ?? "Requiere atención";
}

/**
 * Quien escribio, dicho para el operador. El cliente ve los mensajes del
 * equipo como de la modelo; aqui hay que distinguirlos, porque decidir si
 * intervenir depende de si contesto la IA o una persona.
 */
const ETIQUETAS_DE_REMITENTE: Record<Remitente, string> = {
  cliente: "Cliente",
  ia: "IA",
  jefe: "Jefe",
  sistema: "Sistema",
};

export function etiquetaDeRemitente(sender: Remitente): string {
  return ETIQUETAS_DE_REMITENTE[sender] ?? sender;
}

/** Filtros de la bandeja. `null` es la vista por defecto: todo menos cerradas. */
export const FILTROS_DE_ESTADO: ReadonlyArray<{
  valor: EstadoConversacion | null;
  etiqueta: string;
}> = [
  { valor: null, etiqueta: "Abiertas" },
  { valor: "en_revision", etiqueta: "En revisión" },
  { valor: "activa", etiqueta: "Activas" },
  { valor: "con_servicio", etiqueta: "Con servicio" },
  { valor: "cerrada", etiqueta: "Cerradas" },
];

/** Quien lleva la conversacion, en pocas palabras. */
export function textoDeControl(
  conversacion: Pick<ConversacionDelEquipo, "mode" | "humanOwnerId">,
  usuario: Pick<UsuarioDelPanel, "id">,
): string {
  if (conversacion.mode === "AI_ACTIVE") return "Responde la IA";
  if (conversacion.humanOwnerId === usuario.id) return "La atiendes tú";
  if (conversacion.humanOwnerId) return "La atiende otra persona del equipo";
  return "En manos del equipo";
}

// ------------------------------------------------------------------- reglas

export type AccionesDisponibles = {
  /** Mostrar "Tomar control". */
  tomar: boolean;
  /** La toma quita el control a otra persona: solo admin, con `forzar`. */
  tomarForzando: boolean;
  /** Mostrar "Devolver a la IA". */
  devolver: boolean;
  devolverForzando: boolean;
  /** La barra de respuesta esta activa. */
  escribir: boolean;
  /** Mostrar "Aceptar solicitud" y "Rechazar solicitud". */
  decidir: boolean;
  /** Por que no se puede escribir, para decirlo junto a la barra. */
  motivoSinEscritura: string | null;
};

/**
 * Que puede hacer quien mira la conversacion, con las mismas reglas que el
 * backend aplica en cada ruta: ofrecer un boton que el servidor va a rechazar
 * solo enseña un 409.
 *
 *  - Cerrada: nada.
 *  - En manos de la IA: se puede tomar. Si estaba entregada al equipo, tambien
 *    "devolver", que en ese caso quita la entrega y deja seguir a la IA.
 *  - En manos de quien mira: escribir y devolver.
 *  - En manos de otra persona: un jefe solo mira; un admin puede forzar la
 *    toma o la devolucion y escribir.
 *  - Aceptar o rechazar: hay borrador, esta en revision y aun no es servicio.
 *    No depende de quien tenga el control.
 */
export function accionesDisponibles(
  conversacion: Pick<
    ConversacionDelEquipo,
    "status" | "mode" | "humanOwnerId" | "bookingSessionId" | "serviceId" | "motivosDeAtencion"
  >,
  usuario: UsuarioDelPanel,
): AccionesDisponibles {
  const ninguna: AccionesDisponibles = {
    tomar: false,
    tomarForzando: false,
    devolver: false,
    devolverForzando: false,
    escribir: false,
    decidir: false,
    motivoSinEscritura: null,
  };
  if (conversacion.status === "cerrada") {
    return {
      ...ninguna,
      motivoSinEscritura: "La conversación está cerrada y ya no admite mensajes.",
    };
  }

  const decidir =
    Boolean(conversacion.bookingSessionId) &&
    conversacion.status === "en_revision" &&
    !conversacion.serviceId;
  const esAdmin = usuario.rol === "admin";

  if (conversacion.mode === "AI_ACTIVE") {
    return {
      ...ninguna,
      tomar: true,
      devolver: conversacion.motivosDeAtencion.includes("entregada_al_equipo"),
      decidir,
      motivoSinEscritura: "Responde la IA. Toma el control para escribir tú.",
    };
  }

  const propia = conversacion.humanOwnerId === usuario.id;
  const sinDueno = !conversacion.humanOwnerId;
  if (propia || sinDueno) {
    return {
      ...ninguna,
      tomar: sinDueno,
      devolver: true,
      escribir: propia,
      decidir,
      motivoSinEscritura: propia ? null : "Toma el control para escribir.",
    };
  }

  // La lleva otra persona.
  return {
    ...ninguna,
    tomar: esAdmin,
    tomarForzando: esAdmin,
    devolver: esAdmin,
    devolverForzando: esAdmin,
    escribir: esAdmin,
    decidir,
    motivoSinEscritura: esAdmin
      ? null
      : "La atiende otra persona del equipo. Solo ella o un admin pueden escribir.",
  };
}

/**
 * Resumen del borrador de reserva a partir de los mensajes cargados.
 *
 * No hay ruta para leer el borrador: se toma el ultimo aviso del sistema que
 * abre con "Solicitud lista para revision", que es el resumen que el backend le
 * manda al cliente al cerrar la reserva (`resumenDeReserva`). Si ese aviso no
 * esta en las paginas cargadas, o cambia su redaccion, devuelve `null` y la
 * pantalla lo dice en vez de inventar.
 */
export function resumenDelBorrador(
  mensajes: readonly Pick<MensajeDelChat, "sender" | "body">[],
): string | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i];
    if (
      mensaje.sender === "sistema" &&
      normalizar(mensaje.body).trimStart().startsWith("solicitud lista para revision")
    ) {
      return mensaje.body;
    }
  }
  return null;
}

/** Enlace a un mapa para un pin; `null` si no trae coordenadas validas. */
export function enlaceAlMapa(
  adjunto: Pick<NonNullable<MensajeParaElEquipo["attachment"]>, "lat" | "lng">,
): string | null {
  const { lat, lng } = adjunto;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Vista previa de la bandeja, con quien escribio delante. */
export function vistaPreviaDelEquipo(
  conversacion: Pick<ConversacionDelEquipo, "lastMessage">,
): string {
  const ultimo = conversacion.lastMessage;
  if (!ultimo) return "Sin mensajes todavía.";
  const texto = ultimo.preview.trim() || (ultimo.hasAttachment ? "Archivo adjunto" : "");
  return `${etiquetaDeRemitente(ultimo.sender)}: ${texto}`;
}

// ---------------------------------------------------------- eventos en vivo

const EVENTOS_DEL_CHAT_WEB = new Set([
  "message_created",
  "conversation_mode_changed",
  "conversation_status_changed",
  "receipt_status",
  "typing",
]);

export type QueRecargar = {
  bandeja: boolean;
  /** Pedir lo mas reciente de la conversacion abierta. */
  mensajes: boolean;
  /** `true` enciende "escribiendo", `false` lo apaga, `null` no lo toca. */
  escribiendo: boolean | null;
};

/**
 * Que hay que volver a pedir ante un evento del canal de jefes.
 *
 * Los eventos solo traen ids; el contenido se vuelve a pedir por la API, que es
 * la que aplica el alcance de cada jefe. Un `conversation_mode_changed` sin
 * `conversationId` (lleva `bookingSessionId` o `clientId`) no es del chat web
 * y se ignora.
 *
 * Cualquier evento del chat web recarga la bandeja (orden, insignias, quien
 * tiene el control), salvo `typing`, que llega a cada rato y no cambia nada de
 * ella.
 */
export function queRecargar(
  evento: { type?: string; data?: unknown },
  abiertaId: string | null,
): QueRecargar | null {
  if (!evento.type || !EVENTOS_DEL_CHAT_WEB.has(evento.type)) return null;
  const data = (evento.data ?? {}) as { conversationId?: unknown; activo?: unknown };
  if (typeof data.conversationId !== "string" || !data.conversationId) return null;
  const abierta = data.conversationId === abiertaId;

  if (evento.type === "typing") {
    return {
      bandeja: false,
      mensajes: false,
      escribiendo: abierta ? data.activo !== false : null,
    };
  }
  return {
    bandeja: true,
    mensajes: abierta && (evento.type === "message_created" || evento.type === "receipt_status"),
    // Si contesto alguien, ya no esta escribiendo.
    escribiendo: abierta && evento.type === "message_created" ? false : null,
  };
}

// ------------------------------------------------------------------ errores

export type AccionDelEquipo = "tomar" | "devolver" | "enviar" | "aceptar" | "rechazar";

export type FalloDelEquipo = {
  error: string;
  /** El servidor dijo 409: el estado cambio y hay que releer la bandeja. */
  conflicto?: boolean;
};

const SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

function nombreDelDueno(cuerpo: unknown): string | null | undefined {
  if (!cuerpo || typeof cuerpo !== "object" || !("humanOwner" in cuerpo)) return undefined;
  const dueno = (cuerpo as { humanOwner?: { nombre?: unknown } | null }).humanOwner;
  if (!dueno) return null;
  return typeof dueno.nombre === "string" && dueno.nombre.trim() ? dueno.nombre.trim() : null;
}

/**
 * Traduce un fallo del backend a un texto que diga que pasa y que hacer.
 *
 * Los 409 de tomar o devolver traen quien tiene la conversacion; se nombra a
 * esa persona para que el jefe sepa con quien hablar. Los demas 409 y los 400
 * ya vienen redactados en español por el backend (borrador incompleto, sin
 * modelo disponible, mensaje vacio) y se muestran tal cual.
 */
export function traducirFalloDelEquipo(
  fallo: { status?: number; message?: string; body?: unknown } | null,
  accion: AccionDelEquipo,
): FalloDelEquipo {
  const status = fallo?.status;
  const crudo = fallo?.message?.trim() || "";
  // Sin el texto generico de `apiFetch` ni el punto final, para poder seguir la frase.
  const mensaje = crudo.startsWith("Backend request failed") ? "" : crudo.replace(/[.\s]+$/, "");

  if (status === 409) {
    const dueno = nombreDelDueno(fallo?.body);
    if (dueno !== undefined && (accion === "tomar" || accion === "devolver")) {
      const quien = dueno ?? "otra persona del equipo";
      return {
        conflicto: true,
        error: `La conversación la atiende ${quien}. Habla con esa persona o pide a un admin que la libere.`,
      };
    }
    if (accion === "enviar") {
      return {
        conflicto: true,
        error: mensaje
          ? `${mensaje}. Toma el control para responder.`
          : "Ya no tienes el control de esta conversación. Tómalo de nuevo para responder.",
      };
    }
    return {
      conflicto: true,
      error: mensaje
        ? `${mensaje}. La bandeja se actualizó con su estado actual.`
        : "La conversación cambió mientras tanto. La bandeja se actualizó con su estado actual.",
    };
  }
  if (status === 404) {
    return {
      conflicto: true,
      error: "Esta conversación ya no existe o no está a tu cargo. Elige otra de la bandeja.",
    };
  }
  if (status === 403) {
    return { error: "Tu cuenta no tiene permiso para esta acción." };
  }
  if (status === 429) {
    return { error: "Demasiadas acciones seguidas. Espera unos segundos y vuelve a intentarlo." };
  }
  if (status === 400 && mensaje) {
    return { error: `${mensaje}.` };
  }
  return { error: SIN_CONEXION };
}
