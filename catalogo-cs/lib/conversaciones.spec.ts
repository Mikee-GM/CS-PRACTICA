import {
  crearOptimista,
  cursorMasAntiguo,
  debeMostrarComprobante,
  enlazaConLoConocido,
  marcarEnvio,
  mezclarMensajes,
  momentoCorto,
  vistaPrevia,
  type MensajeDelChat,
  type ResumenDeConversacion,
} from "./conversaciones";

const CONV = "c0000000-0000-4000-8000-000000000001";

function mensaje(
  id: string,
  minuto: number,
  extra: Partial<MensajeDelChat> = {},
): MensajeDelChat {
  return {
    id,
    conversationId: CONV,
    sender: "ia",
    body: `mensaje ${id}`,
    attachment: null,
    clientMessageId: null,
    createdAt: new Date(Date.UTC(2026, 10, 16, 18, minuto)).toISOString(),
    ...extra,
  };
}

describe("mezclarMensajes", () => {
  it("ordena cronologicamente una pagina que llega del mas nuevo al mas antiguo", () => {
    const pagina = [mensaje("c", 3), mensaje("b", 2), mensaje("a", 1)];

    expect(mezclarMensajes([], pagina).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("antepone una pagina antigua sin duplicar los ids que ya estaban", () => {
    const actuales = mezclarMensajes([], [mensaje("c", 3), mensaje("d", 4)]);
    const antigua = [mensaje("c", 3), mensaje("b", 2), mensaje("a", 1)];

    expect(mezclarMensajes(actuales, antigua).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("desempata por id cuando dos mensajes comparten instante", () => {
    const pagina = [mensaje("b", 1), mensaje("a", 1)];

    expect(mezclarMensajes([], pagina).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("deja los optimistas al final aunque el reloj del telefono vaya atrasado", () => {
    const optimista = crearOptimista({
      conversationId: CONV,
      clientMessageId: "k1",
      body: "hola",
      ahora: new Date(Date.UTC(2026, 10, 16, 17, 0)),
    });

    const resultado = mezclarMensajes([optimista], [mensaje("a", 5)]);

    expect(resultado.map((m) => m.id)).toEqual(["a", "local:k1"]);
  });

  it("sustituye el optimista por el confirmado con el mismo clientMessageId", () => {
    const optimista = crearOptimista({
      conversationId: CONV,
      clientMessageId: "k1",
      body: "hola",
    });
    const confirmado = mensaje("srv-1", 2, {
      sender: "cliente",
      body: "hola",
      clientMessageId: "k1",
    });

    const resultado = mezclarMensajes([optimista], [confirmado]);

    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe("srv-1");
    expect(resultado[0].envio).toBeUndefined();
  });

  it("conserva el orden de escritura entre varios optimistas pendientes", () => {
    const uno = crearOptimista({ conversationId: CONV, clientMessageId: "k1", body: "1" });
    const dos = crearOptimista({ conversationId: CONV, clientMessageId: "k2", body: "2" });

    const resultado = mezclarMensajes([uno, dos], [mensaje("a", 1)]);

    expect(resultado.map((m) => m.id)).toEqual(["a", "local:k1", "local:k2"]);
  });

  it("la version nueva de un mensaje sustituye a la anterior", () => {
    const antes = mezclarMensajes([], [mensaje("a", 1, { body: "antes" })]);

    const despues = mezclarMensajes(antes, [mensaje("a", 1, { body: "despues" })]);

    expect(despues.map((m) => m.body)).toEqual(["despues"]);
  });
});

describe("estado de envio y cursores", () => {
  it("marca como fallido solo el optimista indicado", () => {
    const uno = crearOptimista({ conversationId: CONV, clientMessageId: "k1", body: "1" });
    const dos = crearOptimista({ conversationId: CONV, clientMessageId: "k2", body: "2" });

    const resultado = marcarEnvio([uno, dos], "k2", "error");

    expect(resultado.map((m) => m.envio)).toEqual(["enviando", "error"]);
  });

  it("guarda lo necesario para reintentar una ubicacion", () => {
    const optimista = crearOptimista({
      conversationId: CONV,
      clientMessageId: "k1",
      location: { lat: 20.59, lng: -100.39 },
    });

    expect(optimista.attachment).toEqual({ type: "ubicacion" });
    expect(optimista.reintento).toEqual({
      body: undefined,
      location: { lat: 20.59, lng: -100.39 },
    });
  });

  it("el cursor es el confirmado mas antiguo, nunca un optimista", () => {
    const optimista = crearOptimista({ conversationId: CONV, clientMessageId: "k1", body: "x" });

    expect(cursorMasAntiguo([optimista])).toBeNull();
    expect(cursorMasAntiguo(mezclarMensajes([optimista], [mensaje("b", 2), mensaje("a", 1)]))).toBe(
      "a",
    );
  });

  it("detecta un hueco entre la pagina nueva y lo que habia en pantalla", () => {
    const conocidos = mezclarMensajes([], [mensaje("a", 1), mensaje("b", 2)]);

    expect(enlazaConLoConocido(conocidos, [mensaje("c", 3), mensaje("b", 2)])).toBe(true);
    expect(enlazaConLoConocido(conocidos, [mensaje("e", 5), mensaje("d", 4)])).toBe(false);
    // Sin nada confirmado en pantalla no hay hueco que rellenar.
    expect(enlazaConLoConocido([], [mensaje("d", 4)])).toBe(true);
  });
});

describe("debeMostrarComprobante", () => {
  const pide = mensaje("s1", 1, {
    sender: "sistema",
    body: "Total: $2,500.00. Queda pendiente el Comprobante de la transferencia.",
  });

  it("se muestra cuando el sistema pide el comprobante", () => {
    expect(debeMostrarComprobante("en_revision", [pide])).toBe(true);
  });

  it("no depende de acentos ni mayusculas", () => {
    const conAcento = mensaje("s2", 1, { sender: "sistema", body: "Envía tu COMPROBANTÉ" });

    expect(debeMostrarComprobante("activa", [conAcento])).toBe(true);
  });

  it("no se muestra solo por estar en revision (pago en efectivo)", () => {
    const efectivo = mensaje("s1", 1, {
      sender: "sistema",
      body: "Total: $2,500.00. El equipo la revisará y te confirmará por aquí.",
    });

    expect(debeMostrarComprobante("en_revision", [efectivo])).toBe(false);
  });

  it("desaparece cuando el cliente ya envio el comprobante", () => {
    const enviado = mensaje("m2", 2, {
      sender: "cliente",
      body: "",
      attachment: { type: "comprobante" },
    });

    expect(debeMostrarComprobante("en_revision", [pide, enviado])).toBe(false);
  });

  it("vuelve si el sistema lo pide otra vez tras rechazarlo", () => {
    const enviado = mensaje("m2", 2, {
      sender: "cliente",
      attachment: { type: "comprobante" },
    });
    const otraVez = mensaje("s3", 3, {
      sender: "sistema",
      body: "El comprobante no es legible. Envíalo de nuevo.",
    });

    expect(debeMostrarComprobante("con_servicio", [pide, enviado, otraVez])).toBe(true);
  });

  it("ignora el texto de la IA y del jefe: solo cuentan los avisos del sistema", () => {
    const ia = mensaje("i1", 1, { sender: "ia", body: "Cuando puedas manda el comprobante" });

    expect(debeMostrarComprobante("activa", [ia])).toBe(false);
  });

  it("vuelve si el analisis del ultimo comprobante lo rechazo o fallo", () => {
    const enviado = mensaje("m2", 2, {
      sender: "cliente",
      attachment: { type: "comprobante" },
    });

    expect(debeMostrarComprobante("en_revision", [pide, enviado], { m2: "rechazado" })).toBe(true);
    expect(debeMostrarComprobante("en_revision", [pide, enviado], { m2: "error" })).toBe(true);
    expect(debeMostrarComprobante("en_revision", [pide, enviado], { m2: "recibido" })).toBe(false);
    expect(debeMostrarComprobante("en_revision", [pide, enviado], { m2: "en_revision" })).toBe(false);
  });

  it("nunca se muestra en una conversacion cerrada", () => {
    expect(debeMostrarComprobante("cerrada", [pide])).toBe(false);
  });
});

describe("presentacion de la bandeja", () => {
  it("muestra la hora si es de hoy y la fecha si no, en hora de Mexico", () => {
    // 05:30 UTC del 17 es todavia el 16 en Ciudad de Mexico.
    const ahora = new Date("2026-11-17T05:30:00Z");

    expect(momentoCorto("2026-11-17T01:00:00Z", ahora)).toMatch(/19:00|07:00/);
    expect(momentoCorto("2026-11-10T18:00:00Z", ahora)).toMatch(/10/);
  });

  it("antepone Tu a los mensajes propios y nombra los adjuntos sin texto", () => {
    const base: ResumenDeConversacion = {
      id: CONV,
      status: "activa",
      lastMessageAt: null,
      createdAt: "2026-11-16T18:00:00Z",
      employee: { id: "e1", nombreArtistico: "Valeria", slugCatalogo: "valeria", fotoPerfilUrl: null },
      lastMessage: null,
    };

    expect(vistaPrevia(base)).toMatch(/Escribe para empezar/);
    expect(
      vistaPrevia({
        ...base,
        lastMessage: { id: "m", sender: "cliente", preview: "", hasAttachment: true, createdAt: base.createdAt },
      }),
    ).toBe("Tú: Archivo adjunto");
  });
});
