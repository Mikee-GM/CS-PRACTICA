import {
  accionPendiente,
  errorDelMeGusta,
  falloDelFeed,
  etiquetaDeDiapositiva,
  fechaDelPost,
  loginConRegreso,
  mediaOrdenada,
  meGustaVisible,
  MENSAJE_SIN_EDAD,
  paginaDelFeed,
  PROPORCION_MAXIMA,
  PROPORCION_MINIMA,
  proporcionDelCarrusel,
  reconciliarMeGusta,
  registroConRegreso,
  REGLAS_DE_MEDIA,
  rutaDelFeed,
  rutaDelPerfil,
  textoDeMeGusta,
  unirPaginas,
  validarMediaLocal,
  type MediaDelPost,
  type PostDelFeed,
} from "./posts";

function post(id: string, extra: Partial<PostDelFeed> = {}): PostDelFeed {
  return {
    id,
    caption: "",
    publishedAt: "2026-11-17T18:00:00.000Z",
    likeCount: 0,
    likedByMe: false,
    employee: {
      id: "e1",
      nombreArtistico: "Valentina",
      slugCatalogo: "valentina",
      fotoPerfilUrl: null,
    },
    media: [],
    ...extra,
  };
}

function media(position: number, extra: Partial<MediaDelPost> = {}): MediaDelPost {
  return {
    id: `m${position}`,
    kind: "imagen",
    url: `https://x.r2.dev/${position}.jpg`,
    posterUrl: null,
    width: null,
    height: null,
    durationMs: null,
    position,
    ...extra,
  };
}

describe("rutaDelFeed", () => {
  it("arma el feed general con el limite por defecto", () => {
    expect(rutaDelFeed()).toBe("/api/feed?limit=10");
  });

  it("pasa el cursor tal cual, codificado, sin interpretarlo", () => {
    expect(rutaDelFeed({ cursor: "abc+/=", limit: 5 })).toBe(
      "/api/feed?limit=5&cursor=abc%2B%2F%3D",
    );
  });

  it("acota el limite entre 1 y 20", () => {
    expect(rutaDelFeed({ limit: 500 })).toBe("/api/feed?limit=20");
    expect(rutaDelFeed({ limit: 0 })).toBe("/api/feed?limit=1");
    expect(rutaDelFeed({ limit: Number.NaN })).toBe("/api/feed?limit=10");
  });

  it("codifica el slug del perfil", () => {
    expect(rutaDelFeed({ slug: "ana maria/x" })).toBe(
      "/api/feed/models/ana%20maria%2Fx?limit=10",
    );
  });
});

describe("unirPaginas", () => {
  it("añade la pagina siguiente al final, en el orden del servidor", () => {
    const resultado = unirPaginas([post("a"), post("b")], [post("c"), post("d")]);
    expect(resultado.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("descarta los repetidos y conserva el que ya estaba en pantalla", () => {
    const enPantalla = post("b", { likedByMe: true, likeCount: 3 });
    const resultado = unirPaginas(
      [post("a"), enPantalla],
      [post("b", { likedByMe: false, likeCount: 2 }), post("c")],
    );
    expect(resultado.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(resultado[1]).toBe(enPantalla);
  });

  it("descarta repetidos dentro de la misma pagina", () => {
    expect(unirPaginas([], [post("a"), post("a"), post("b")]).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("no muta las listas de entrada", () => {
    const actuales = [post("a")];
    unirPaginas(actuales, [post("b")]);
    expect(actuales).toHaveLength(1);
  });
});

describe("mediaOrdenada", () => {
  it("ordena por posicion sin mutar", () => {
    const original = [media(2), media(0), media(1)];
    expect(mediaOrdenada(original).map((m) => m.position)).toEqual([0, 1, 2]);
    expect(original.map((m) => m.position)).toEqual([2, 0, 1]);
  });
});

describe("me gusta optimista", () => {
  const confirmado = { liked: false, likeCount: 4 };

  it("sin cambio de deseo se pinta lo confirmado y no se pide nada", () => {
    expect(meGustaVisible(confirmado, false)).toBe(confirmado);
    expect(accionPendiente(confirmado, false)).toBeNull();
  });

  it("dar me gusta suma uno al instante y pide PUT", () => {
    expect(meGustaVisible(confirmado, true)).toEqual({ liked: true, likeCount: 5 });
    expect(accionPendiente(confirmado, true)).toBe("PUT");
  });

  it("quitarlo resta uno, sin bajar de cero, y pide DELETE", () => {
    const dado = { liked: true, likeCount: 0 };
    expect(meGustaVisible(dado, false)).toEqual({ liked: false, likeCount: 0 });
    expect(accionPendiente(dado, false)).toBe("DELETE");
  });

  it("un doble toque mientras va la peticion no deja nada pendiente", () => {
    // Primer toque: deseo true, sale PUT. Segundo toque antes de volver: deseo false.
    const tras = reconciliarMeGusta(confirmado, { liked: true, likeCount: 5 });
    expect(accionPendiente(tras, false)).toBe("DELETE");
    // Si el segundo toque llega antes de mandar nada, no hace falta peticion.
    expect(accionPendiente(confirmado, false)).toBeNull();
  });

  it("si falla, volver el deseo a lo confirmado revierte la pantalla", () => {
    const deseado = true;
    expect(meGustaVisible(confirmado, deseado).likeCount).toBe(5);
    const revertido = confirmado.liked;
    expect(meGustaVisible(confirmado, revertido)).toEqual(confirmado);
  });

  it("el servidor manda sobre el contador optimista", () => {
    // Otro cliente dio me gusta a la vez: el servidor dice 7, no 5.
    expect(reconciliarMeGusta(confirmado, { liked: true, likeCount: 7 })).toEqual({
      liked: true,
      likeCount: 7,
    });
  });

  it("una respuesta incompleta deja lo confirmado", () => {
    expect(reconciliarMeGusta(confirmado, null)).toBe(confirmado);
    expect(reconciliarMeGusta(confirmado, { liked: "si", likeCount: 2 })).toBe(confirmado);
    expect(reconciliarMeGusta(confirmado, { liked: true, likeCount: Infinity })).toBe(
      confirmado,
    );
  });

  it("explica el 404 y el 429 por separado", () => {
    expect(errorDelMeGusta(404)).toMatch(/ya no está disponible/);
    expect(errorDelMeGusta(429)).toMatch(/Espera un momento/);
    expect(errorDelMeGusta(null)).toMatch(/conexión/);
  });

  it("formatea el contador en es-MX", () => {
    expect(textoDeMeGusta(1234)).toBe("1,234 me gusta");
  });
});

describe("fechaDelPost", () => {
  // 17 nov 2026 12:00 en Ciudad de Mexico (UTC-6).
  const ahora = new Date("2026-11-17T18:00:00.000Z");

  it("de hoy muestra la hora en Mexico", () => {
    expect(fechaDelPost("2026-11-17T15:30:00.000Z", ahora)).toMatch(/9:30/);
  });

  it("usa el dia de Mexico, no el UTC", () => {
    // 01:00 UTC del 18 es todavia el 17 a las 19:00 en Mexico.
    const casiMedianoche = new Date("2026-11-18T01:00:00.000Z");
    expect(fechaDelPost("2026-11-17T20:00:00.000Z", casiMedianoche)).toMatch(/2:00/);
  });

  it("de otro dia del año muestra dia y mes", () => {
    const texto = fechaDelPost("2026-10-03T18:00:00.000Z", ahora);
    expect(texto).toMatch(/3/);
    expect(texto).toMatch(/oct/);
    expect(texto).not.toMatch(/2026/);
  });

  it("de otro año añade el año", () => {
    expect(fechaDelPost("2025-10-03T18:00:00.000Z", ahora)).toMatch(/2025/);
  });

  it("una fecha invalida no rompe", () => {
    expect(fechaDelPost("no-es-fecha", ahora)).toBe("");
  });
});

describe("textos del carrusel y rutas", () => {
  it("etiqueta cada diapositiva con su tipo y posicion", () => {
    expect(etiquetaDeDiapositiva("imagen", 1, 5)).toBe("Imagen 2 de 5");
    expect(etiquetaDeDiapositiva("video", 0, 3)).toBe("Video 1 de 3");
  });

  it("acota la proporcion del carrusel", () => {
    expect(proporcionDelCarrusel([])).toBe(PROPORCION_MINIMA);
    expect(proporcionDelCarrusel([media(0, { width: 1080, height: 1080 })])).toBe(1);
    expect(proporcionDelCarrusel([media(0, { width: 1080, height: 1920 })])).toBe(
      PROPORCION_MINIMA,
    );
    expect(proporcionDelCarrusel([media(0, { width: 4000, height: 1000 })])).toBe(
      PROPORCION_MAXIMA,
    );
    // La que manda es la primera por posicion, no por orden de llegada.
    expect(
      proporcionDelCarrusel([
        media(1, { width: 4000, height: 1000 }),
        media(0, { width: 1000, height: 1000 }),
      ]),
    ).toBe(1);
  });

  it("arma el login con regreso y el perfil codificado", () => {
    expect(loginConRegreso("/modelos/valentina")).toBe(
      "/ingresar?siguiente=%2Fmodelos%2Fvalentina",
    );
    expect(rutaDelPerfil("ana maria")).toBe("/modelos/ana%20maria");
  });
});

describe("validarMediaLocal", () => {
  const MB = 1024 * 1024;
  const imagen = { tipo: "image/jpeg", bytes: 2 * MB };
  const video = { tipo: "video/mp4", bytes: 10 * MB, duracionMs: 15_000 };

  it("acepta imagenes y videos dentro de las reglas", () => {
    expect(validarMediaLocal([imagen, { ...imagen, tipo: "image/webp" }, video])).toEqual([]);
  });

  it("exige al menos un archivo", () => {
    expect(validarMediaLocal([])).toEqual([
      { indice: null, mensaje: expect.stringMatching(/al menos/) },
    ]);
  });

  it("no admite mas de 10 archivos", () => {
    const errores = validarMediaLocal(Array.from({ length: 11 }, () => imagen));
    expect(errores).toEqual([{ indice: null, mensaje: expect.stringMatching(/10 archivos/) }]);
  });

  it("no admite mas de 3 videos", () => {
    const errores = validarMediaLocal([video, video, video, video]);
    expect(errores).toEqual([{ indice: null, mensaje: expect.stringMatching(/3 videos/) }]);
  });

  it("rechaza tipos fuera de la lista", () => {
    const errores = validarMediaLocal([{ tipo: "image/gif", bytes: MB }, imagen]);
    expect(errores).toEqual([{ indice: 0, mensaje: expect.stringMatching(/archivo 1/) }]);
  });

  it("acepta el limite exacto de video y rechaza lo que lo pasa", () => {
    const justo = {
      tipo: "video/webm",
      bytes: REGLAS_DE_MEDIA.maximoBytesVideo,
      duracionMs: REGLAS_DE_MEDIA.maximaDuracionVideoMs,
    };
    expect(validarMediaLocal([justo])).toEqual([]);

    const errores = validarMediaLocal([
      imagen,
      { ...justo, bytes: justo.bytes + 1, duracionMs: 30_001 },
    ]);
    expect(errores.map((e) => e.indice)).toEqual([1, 1]);
    expect(errores[0].mensaje).toMatch(/20 MB/);
    expect(errores[1].mensaje).toMatch(/30 segundos/);
  });

  it("un video sin duracion legible no pasa", () => {
    expect(validarMediaLocal([{ ...video, duracionMs: null }])).toEqual([
      { indice: 0, mensaje: expect.stringMatching(/duración/) },
    ]);
  });

  it("deja pasar MOV: el backend decide por los bytes", () => {
    expect(validarMediaLocal([{ ...video, tipo: "video/quicktime" }])).toEqual([]);
  });

  it("las imagenes no tienen tope de duracion ni de video", () => {
    expect(validarMediaLocal([{ tipo: "image/png", bytes: 30 * MB }])).toEqual([]);
  });
});

describe("falloDelFeed", () => {
  it("un 403 es la cuenta sin declaracion 18+, en el feed y en el perfil", () => {
    expect(falloDelFeed(403, { perfil: false })).toEqual({
      estado: "sin-edad",
      mensaje: MENSAJE_SIN_EDAD,
    });
    expect(falloDelFeed(403, { perfil: true }).estado).toBe("sin-edad");
  });

  it("un 404 en el perfil es la modelo no visible, no un error de red", () => {
    const lectura = falloDelFeed(404, { perfil: true });
    expect(lectura.estado).toBe("no-disponible");
    expect(lectura).toHaveProperty("mensaje", expect.stringMatching(/esta modelo/));
  });

  it("un 404 en el feed general es la cuenta sin ficha de cliente", () => {
    const lectura = falloDelFeed(404, { perfil: false });
    expect(lectura.estado).toBe("no-disponible");
    expect(lectura).toHaveProperty("mensaje", expect.stringMatching(/ficha de cliente/));
  });

  it.each([null, 500, 502, 429])("lo demas (%s) es un error que se puede reintentar", (status) => {
    expect(falloDelFeed(status, { perfil: true }).estado).toBe("error");
  });
});

describe("paginaDelFeed", () => {
  it("conserva una pagina bien formada", () => {
    const pagina = { items: [post("a")], nextCursor: "c1" };
    expect(paginaDelFeed(pagina)).toEqual(pagina);
  });

  it.each([null, undefined, "texto", { items: "no" }, {}])(
    "lee como vacia una respuesta sin forma de pagina (%p)",
    (respuesta) => {
      expect(paginaDelFeed(respuesta)).toEqual({ items: [], nextCursor: null });
    },
  );

  it("un cursor vacio o que no es texto no invita a pedir otra pagina", () => {
    expect(paginaDelFeed({ items: [], nextCursor: "" }).nextCursor).toBeNull();
    expect(paginaDelFeed({ items: [], nextCursor: 3 }).nextCursor).toBeNull();
  });
});

describe("registroConRegreso", () => {
  it("codifica la ruta de regreso como hace el login", () => {
    expect(registroConRegreso("/modelos/valentina")).toBe(
      "/registro?siguiente=%2Fmodelos%2Fvalentina",
    );
    expect(loginConRegreso("/modelos/valentina")).toBe(
      "/ingresar?siguiente=%2Fmodelos%2Fvalentina",
    );
  });
});
