import {
  accionesDisponibles,
  enlaceAlMapa,
  etiquetaDeMotivo,
  etiquetaDeRemitente,
  queRecargar,
  resumenDelBorrador,
  textoDeControl,
  traducirFalloDelEquipo,
  vistaPreviaDelEquipo,
  type ConversacionDelEquipo,
  type UsuarioDelPanel,
} from "./chats-del-equipo";
import { mezclarMensajes } from "./conversaciones";

const YO: UsuarioDelPanel = { id: "u-yo", rol: "jefe" };
const ADMIN: UsuarioDelPanel = { id: "u-admin", rol: "admin" };

function conversacion(extra: Partial<ConversacionDelEquipo> = {}): ConversacionDelEquipo {
  return {
    id: "c1",
    status: "activa",
    mode: "AI_ACTIVE",
    humanOwnerId: null,
    lastMessageAt: null,
    createdAt: "2026-11-16T18:00:00Z",
    bookingSessionId: null,
    serviceId: null,
    employee: { id: "e1", nombreArtistico: "Valeria", fotoPerfilUrl: null },
    client: { id: "cl1", nombre: "Carlos" },
    lastMessage: null,
    requiereAtencion: false,
    motivosDeAtencion: [],
    comprobanteEnRevision: false,
    comprobantePendiente: false,
    ...extra,
  };
}

describe("accionesDisponibles", () => {
  it("con la IA al mando se puede tomar pero no escribir", () => {
    const acciones = accionesDisponibles(conversacion(), YO);

    expect(acciones.tomar).toBe(true);
    expect(acciones.tomarForzando).toBe(false);
    expect(acciones.escribir).toBe(false);
    expect(acciones.devolver).toBe(false);
    expect(acciones.motivoSinEscritura).toMatch(/Toma el control/);
  });

  it("si la IA la entrego al equipo, tambien se puede devolver sin tomarla", () => {
    const acciones = accionesDisponibles(
      conversacion({ motivosDeAtencion: ["entregada_al_equipo"] }),
      YO,
    );

    expect(acciones.devolver).toBe(true);
    expect(acciones.devolverForzando).toBe(false);
  });

  it("quien la tomo escribe y la devuelve", () => {
    const acciones = accionesDisponibles(
      conversacion({ mode: "HUMAN_ACTIVE", humanOwnerId: YO.id }),
      YO,
    );

    expect(acciones).toMatchObject({ tomar: false, devolver: true, escribir: true });
    expect(acciones.motivoSinEscritura).toBeNull();
  });

  it("un jefe no puede tocar la que lleva otra persona", () => {
    const acciones = accionesDisponibles(
      conversacion({ mode: "HUMAN_ACTIVE", humanOwnerId: "u-otro" }),
      YO,
    );

    expect(acciones).toMatchObject({ tomar: false, devolver: false, escribir: false });
    expect(acciones.motivoSinEscritura).toMatch(/otra persona/);
  });

  it("un admin puede forzar la toma, la devolucion y escribir", () => {
    const acciones = accionesDisponibles(
      conversacion({ mode: "HUMAN_ACTIVE", humanOwnerId: "u-otro" }),
      ADMIN,
    );

    expect(acciones).toMatchObject({
      tomar: true,
      tomarForzando: true,
      devolver: true,
      devolverForzando: true,
      escribir: true,
    });
  });

  it("en manos del equipo sin dueno se puede tomar, pero no escribir aun", () => {
    const acciones = accionesDisponibles(conversacion({ mode: "HUMAN_ACTIVE" }), YO);

    expect(acciones).toMatchObject({ tomar: true, devolver: true, escribir: false });
  });

  it("aceptar y rechazar solo con borrador, en revision y sin servicio", () => {
    const conBorrador = { bookingSessionId: "b1", status: "en_revision" as const };

    expect(accionesDisponibles(conversacion(conBorrador), YO).decidir).toBe(true);
    expect(
      accionesDisponibles(
        conversacion({ ...conBorrador, mode: "HUMAN_ACTIVE", humanOwnerId: "u-otro" }),
        YO,
      ).decidir,
    ).toBe(true);
    expect(accionesDisponibles(conversacion({ status: "en_revision" }), YO).decidir).toBe(false);
    expect(
      accionesDisponibles(conversacion({ ...conBorrador, status: "activa" }), YO).decidir,
    ).toBe(false);
    expect(
      accionesDisponibles(conversacion({ ...conBorrador, serviceId: "s1" }), YO).decidir,
    ).toBe(false);
  });

  it("una conversacion cerrada no ofrece nada, ni al admin", () => {
    const acciones = accionesDisponibles(
      conversacion({ status: "cerrada", bookingSessionId: "b1", mode: "HUMAN_ACTIVE", humanOwnerId: ADMIN.id }),
      ADMIN,
    );

    expect(acciones).toMatchObject({
      tomar: false,
      devolver: false,
      escribir: false,
      decidir: false,
    });
    expect(acciones.motivoSinEscritura).toMatch(/cerrada/);
  });
});

describe("etiquetas", () => {
  it("nombra cada motivo de atencion en español", () => {
    expect(etiquetaDeMotivo("entregada_al_equipo")).toBe("Pide atención del equipo");
    expect(etiquetaDeMotivo("en_revision")).toBe("Solicitud por revisar");
    expect(etiquetaDeMotivo("comprobante_en_revision")).toBe("Comprobante por revisar");
    expect(etiquetaDeMotivo("fallos_ia")).toBe("La IA no pudo responder");
    expect(etiquetaDeMotivo("cliente_sin_respuesta")).toBe("Cliente sin respuesta");
  });

  it("distingue IA, Jefe, Cliente y Sistema para el operador", () => {
    expect(["ia", "jefe", "cliente", "sistema"].map((s) => etiquetaDeRemitente(s as never))).toEqual([
      "IA",
      "Jefe",
      "Cliente",
      "Sistema",
    ]);
  });

  it("dice quien lleva la conversacion", () => {
    expect(textoDeControl({ mode: "AI_ACTIVE", humanOwnerId: null }, YO)).toBe("Responde la IA");
    expect(textoDeControl({ mode: "HUMAN_ACTIVE", humanOwnerId: YO.id }, YO)).toBe(
      "La atiendes tú",
    );
    expect(textoDeControl({ mode: "HUMAN_ACTIVE", humanOwnerId: "x" }, YO)).toMatch(
      /otra persona/,
    );
  });

  it("antepone el remitente en la vista previa y nombra el adjunto", () => {
    expect(vistaPreviaDelEquipo({ lastMessage: null })).toBe("Sin mensajes todavía.");
    expect(
      vistaPreviaDelEquipo({
        lastMessage: { id: "m", sender: "cliente", preview: "", hasAttachment: true, createdAt: "" },
      }),
    ).toBe("Cliente: Archivo adjunto");
  });
});

describe("resumenDelBorrador", () => {
  it("toma el ultimo resumen de solicitud del sistema, sin depender de acentos", () => {
    const mensajes = [
      { sender: "sistema" as const, body: "Solicitud lista para revisión con Valeria: 2 horas." },
      { sender: "ia" as const, body: "Solicitud lista para revision (la IA no cuenta)" },
      { sender: "sistema" as const, body: "SOLICITUD LISTA PARA REVISION con Valeria: 3 horas." },
      { sender: "sistema" as const, body: "Una persona del equipo continúa esta conversación contigo." },
    ];

    expect(resumenDelBorrador(mensajes)).toBe("SOLICITUD LISTA PARA REVISION con Valeria: 3 horas.");
  });

  it("devuelve null si el resumen no esta en lo cargado", () => {
    expect(resumenDelBorrador([{ sender: "sistema", body: "Tu solicitud fue aprobada." }])).toBeNull();
  });
});

describe("enlaceAlMapa", () => {
  it("arma el enlace con coordenadas validas y rechaza las que no lo son", () => {
    expect(enlaceAlMapa({ lat: 20.59, lng: -100.39 })).toBe(
      "https://www.google.com/maps/search/?api=1&query=20.59,-100.39",
    );
    expect(enlaceAlMapa({})).toBeNull();
    expect(enlaceAlMapa({ lat: 120, lng: 0 })).toBeNull();
    expect(enlaceAlMapa({ lat: Number.NaN, lng: 0 })).toBeNull();
  });
});

describe("queRecargar", () => {
  it("ignora eventos que no son del chat web, como el modo de Telegram sin conversationId", () => {
    expect(queRecargar({ type: "chat_message", data: { conversationId: "c1" } }, "c1")).toBeNull();
    expect(
      queRecargar({ type: "conversation_mode_changed", data: { bookingSessionId: "b1" } }, "c1"),
    ).toBeNull();
    expect(queRecargar({ type: "heartbeat" }, "c1")).toBeNull();
  });

  it("un mensaje nuevo en la abierta recarga bandeja y mensajes y apaga escribiendo", () => {
    expect(
      queRecargar({ type: "message_created", data: { conversationId: "c1", messageId: "m" } }, "c1"),
    ).toEqual({ bandeja: true, mensajes: true, escribiendo: false });
  });

  it("un mensaje en otra conversacion solo recarga la bandeja", () => {
    expect(
      queRecargar({ type: "message_created", data: { conversationId: "c2", messageId: "m" } }, "c1"),
    ).toEqual({ bandeja: true, mensajes: false, escribiendo: null });
  });

  it("modo y estado recargan la bandeja; el comprobante tambien los mensajes", () => {
    expect(
      queRecargar({ type: "conversation_mode_changed", data: { conversationId: "c1", mode: "HUMAN_ACTIVE" } }, "c1"),
    ).toEqual({ bandeja: true, mensajes: false, escribiendo: null });
    expect(
      queRecargar({ type: "receipt_status", data: { conversationId: "c1", status: "recibido" } }, "c1"),
    ).toEqual({ bandeja: true, mensajes: true, escribiendo: null });
  });

  it("typing no recarga nada; enciende salvo activo en falso y solo en la abierta", () => {
    expect(queRecargar({ type: "typing", data: { conversationId: "c1" } }, "c1")).toEqual({
      bandeja: false,
      mensajes: false,
      escribiendo: true,
    });
    expect(
      queRecargar({ type: "typing", data: { conversationId: "c1", activo: false } }, "c1")?.escribiendo,
    ).toBe(false);
    expect(queRecargar({ type: "typing", data: { conversationId: "c2" } }, "c1")?.escribiendo).toBeNull();
  });
});

describe("traducirFalloDelEquipo", () => {
  it("nombra a quien tiene la conversacion en el 409 de tomar", () => {
    const fallo = traducirFalloDelEquipo(
      {
        status: 409,
        message: "La conversación la atiende otra persona del equipo",
        body: { humanOwner: { id: "u2", nombre: "Ana López" } },
      },
      "tomar",
    );

    expect(fallo.conflicto).toBe(true);
    expect(fallo.error).toMatch(/Ana López/);
  });

  it("sin nombre del dueno lo dice de forma generica", () => {
    expect(
      traducirFalloDelEquipo({ status: 409, body: { humanOwner: null } }, "devolver").error,
    ).toMatch(/otra persona del equipo/);
  });

  it("los demas 409 usan el texto del backend sin repetir el punto", () => {
    expect(
      traducirFalloDelEquipo({ status: 409, message: "Esta conversación está cerrada." }, "aceptar")
        .error,
    ).toBe("Esta conversación está cerrada. La bandeja se actualizó con su estado actual.");
  });

  it("el 409 al enviar indica que hay que tomar el control", () => {
    expect(traducirFalloDelEquipo({ status: 409 }, "enviar").error).toMatch(/Tómalo de nuevo/);
  });

  it("404, 429, 400 y sin red dicen que hacer", () => {
    expect(traducirFalloDelEquipo({ status: 404 }, "aceptar")).toMatchObject({ conflicto: true });
    expect(traducirFalloDelEquipo({ status: 429 }, "enviar").error).toMatch(/Espera/);
    expect(
      traducirFalloDelEquipo({ status: 400, message: "La solicitud está incompleta" }, "aceptar")
        .error,
    ).toBe("La solicitud está incompleta.");
    expect(traducirFalloDelEquipo(null, "tomar").error).toMatch(/Revisa tu conexión/);
    expect(
      traducirFalloDelEquipo({ status: 500, message: "Backend request failed with 500" }, "tomar")
        .error,
    ).toMatch(/Revisa tu conexión/);
  });
});

describe("mezcla de mensajes del equipo", () => {
  it("reutiliza la mezcla del cliente conservando los campos del equipo", () => {
    const base = {
      conversationId: "c1",
      sender: "cliente" as const,
      body: "",
      clientMessageId: null,
      receiptValidationId: null,
    };
    const pin = {
      ...base,
      id: "b",
      attachment: { type: "ubicacion" as const, lat: 20.5, lng: -100.3 },
      createdAt: "2026-11-16T18:02:00Z",
    };
    const texto = { ...base, id: "a", attachment: null, createdAt: "2026-11-16T18:01:00Z" };

    const resultado = mezclarMensajes([pin], [texto, pin]);

    expect(resultado.map((m) => m.id)).toEqual(["a", "b"]);
    expect(resultado[1].attachment?.lat).toBe(20.5);
  });
});
