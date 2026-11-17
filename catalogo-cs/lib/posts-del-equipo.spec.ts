import {
  accionesDelPost,
  avisoDeDuracion,
  contarPendientes,
  duracionLegible,
  esEdicionDeAprobado,
  esEstadoFiltrable,
  etiquetaDeAutor,
  etiquetaDeEstadoDelPost,
  FILTROS_DE_LA_COLA,
  fraccionReproducida,
  modelosDeLaCola,
  motivoParaNoAprobar,
  queRecargarPorEvento,
  resumenDeMedia,
  rutaDeLaCola,
  siguienteTrasQuitar,
  textoCortoDelContador,
  textoDelContador,
  tiempoEnCola,
  traducirFalloDelPost,
  unirCola,
  validarMotivo,
  videoVisto,
  type PostDelEquipo,
} from "./posts-del-equipo";
import type { MediaDelPost } from "./posts";

function media(extra: Partial<MediaDelPost> = {}): MediaDelPost {
  return {
    id: "m1",
    kind: "imagen",
    url: "https://cdn/x.jpg",
    posterUrl: null,
    width: 1080,
    height: 1350,
    durationMs: null,
    position: 0,
    ...extra,
  };
}

function post(extra: Partial<PostDelEquipo> = {}): PostDelEquipo {
  return {
    id: "p1",
    caption: "Hola",
    status: "pendiente",
    rejectionReason: null,
    submittedAt: "2026-11-17T10:00:00Z",
    reviewedAt: null,
    publishedAt: null,
    createdAt: "2026-11-17T09:00:00Z",
    likeCount: 0,
    authorRole: "empleada",
    employee: { id: "e1", nombreArtistico: "Valeria", fotoPerfilUrl: null },
    media: [media()],
    ...extra,
  };
}

describe("etiquetas", () => {
  it("nombra cada estado y cada autor en español", () => {
    expect(etiquetaDeEstadoDelPost("pendiente")).toBe("Por revisar");
    expect(etiquetaDeEstadoDelPost("aprobado")).toBe("Publicada");
    expect(etiquetaDeEstadoDelPost("archivado")).toBe("Archivada");
    expect(etiquetaDeAutor("empleada")).toBe("La modelo");
    expect(etiquetaDeAutor("admin")).toBe("Un admin");
  });

  it("los filtros empiezan por pendiente y no ofrecen borradores", () => {
    expect(FILTROS_DE_LA_COLA[0].valor).toBe("pendiente");
    expect(FILTROS_DE_LA_COLA.map((f) => f.valor)).not.toContain("borrador");
    expect(esEstadoFiltrable("rechazado")).toBe(true);
    expect(esEstadoFiltrable("borrador")).toBe(false);
    expect(esEstadoFiltrable("publicado")).toBe(false);
  });

  it("resume la media contando fotos y videos", () => {
    expect(resumenDeMedia([media(), media({ kind: "video" }), media()])).toBe("2 fotos y 1 video");
    expect(resumenDeMedia([media({ kind: "video" })])).toBe("1 video");
    expect(resumenDeMedia([])).toBe("Sin media");
  });
});

describe("accionesDelPost", () => {
  it("pendiente: aprobar, rechazar y archivar", () => {
    expect(accionesDelPost(post())).toEqual({ aprobar: true, rechazar: true, archivar: true });
  });

  it("aprobado: solo archivar", () => {
    expect(accionesDelPost(post({ status: "aprobado" }))).toEqual({
      aprobar: false,
      rechazar: false,
      archivar: true,
    });
  });

  it.each(["rechazado", "archivado", "borrador"] as const)("%s: nada", (status) => {
    expect(accionesDelPost(post({ status }))).toEqual({
      aprobar: false,
      rechazar: false,
      archivar: false,
    });
  });
});

describe("esEdicionDeAprobado", () => {
  it("es edicion si esta pendiente y ya se publico alguna vez", () => {
    expect(esEdicionDeAprobado(post({ publishedAt: "2026-11-10T00:00:00Z" }))).toBe(true);
  });

  it("no lo es si es nuevo o si ya esta aprobado", () => {
    expect(esEdicionDeAprobado(post())).toBe(false);
    expect(
      esEdicionDeAprobado(post({ status: "aprobado", publishedAt: "2026-11-10T00:00:00Z" })),
    ).toBe(false);
  });
});

describe("tiempoEnCola", () => {
  const ahora = new Date("2026-11-17T12:00:00Z");

  it("dice minutos, horas o dias", () => {
    expect(tiempoEnCola("2026-11-17T11:59:40Z", ahora)).toBe("hace un momento");
    expect(tiempoEnCola("2026-11-17T11:55:00Z", ahora)).toBe("hace 5 min");
    expect(tiempoEnCola("2026-11-17T09:00:00Z", ahora)).toBe("hace 3 h");
    expect(tiempoEnCola("2026-11-16T11:00:00Z", ahora)).toBe("hace 1 día");
    expect(tiempoEnCola("2026-11-14T12:00:00Z", ahora)).toBe("hace 3 días");
  });

  it("sin fecha o con fecha invalida no dice nada; una fecha futura no da negativos", () => {
    expect(tiempoEnCola(null, ahora)).toBe("");
    expect(tiempoEnCola("no-es-fecha", ahora)).toBe("");
    expect(tiempoEnCola("2026-11-17T12:10:00Z", ahora)).toBe("hace un momento");
  });
});

describe("duracion", () => {
  it("escribe minutos y segundos", () => {
    expect(duracionLegible(27_400)).toBe("0:27");
    expect(duracionLegible(65_000)).toBe("1:05");
    expect(duracionLegible(null)).toBeNull();
    expect(duracionLegible(0)).toBeNull();
  });

  it("avisa si el video real supera el tope o no coincide con lo declarado", () => {
    expect(avisoDeDuracion(27_000, 27.3)).toBeNull();
    expect(avisoDeDuracion(27_000, 41)).toBe("Dura 0:41: supera los 30 segundos permitidos.");
    expect(avisoDeDuracion(27_000, 12)).toBe("Dura 0:12, aunque se declaró 0:27.");
    expect(avisoDeDuracion(null, 12)).toBeNull();
    expect(avisoDeDuracion(27_000, null)).toBeNull();
    expect(avisoDeDuracion(27_000, Number.NaN)).toBeNull();
  });
});

describe("validarMotivo", () => {
  it("exige texto y lo recorta", () => {
    expect(validarMotivo("   ")).toEqual({ error: expect.stringMatching(/Escribe el motivo/) });
    expect(validarMotivo("  Foto borrosa ")).toEqual({ motivo: "Foto borrosa" });
  });

  it("corta en 500 caracteres", () => {
    expect(validarMotivo("x".repeat(500))).toEqual({ motivo: "x".repeat(500) });
    expect(validarMotivo("x".repeat(501))).toEqual({ error: expect.stringMatching(/500/) });
  });
});

describe("revision de la media", () => {
  it("cuenta solo lo reproducido, uniendo tramos solapados", () => {
    expect(fraccionReproducida([[0, 10]], 20)).toBe(0.5);
    expect(fraccionReproducida([[0, 10], [5, 15]], 20)).toBe(0.75);
    expect(fraccionReproducida([[12, 20], [0, 4]], 20)).toBe(0.6);
    expect(fraccionReproducida([[0, 30]], 20)).toBe(1);
    expect(fraccionReproducida([], 20)).toBe(0);
    expect(fraccionReproducida([[0, 5]], Number.NaN)).toBe(0);
  });

  it("saltar al final no cuenta como haberlo visto", () => {
    // Primer segundo y ultimo segundo: lo que deja `played` tras arrastrar la barra.
    const fraccion = fraccionReproducida([[0, 1], [19, 20]], 20);
    expect(videoVisto(fraccion)).toBe(false);
    expect(videoVisto(fraccionReproducida([[0, 18.5]], 20))).toBe(true);
  });

  it("dice que falta por revisar, nombrando cada media", () => {
    const lista = [
      media({ id: "a" }),
      media({ id: "b", kind: "video" }),
      media({ id: "c" }),
    ];
    expect(motivoParaNoAprobar(lista, new Set(["a", "b", "c"]))).toBeNull();
    expect(motivoParaNoAprobar(lista, new Set(["a", "b"]))).toBe("Antes de aprobar revisa foto 3.");
    expect(motivoParaNoAprobar(lista, new Set(["a"]))).toBe(
      "Antes de aprobar revisa video 2 y foto 3. Los videos se cuentan como vistos al reproducirlos completos.",
    );
  });
});

describe("la cola", () => {
  it("arma la ruta con el estado por defecto y acota el limite", () => {
    expect(rutaDeLaCola()).toBe("/api/staff/posts?estado=pendiente&limit=50");
    expect(rutaDeLaCola({ estado: "aprobado", employeeId: "e1", cursor: "a+b", limit: 500 })).toBe(
      "/api/staff/posts?estado=aprobado&employeeId=e1&cursor=a%2Bb&limit=50",
    );
    expect(rutaDeLaCola({ limit: 0 })).toBe("/api/staff/posts?estado=pendiente&limit=1");
  });

  it("une paginas sin repetir", () => {
    const unida = unirCola([post({ id: "a" }), post({ id: "b" })], [post({ id: "b" }), post({ id: "c" })]);
    expect(unida.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("tras quitar uno pasa al siguiente, o al anterior si era el ultimo", () => {
    const lista = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(siguienteTrasQuitar(lista, "a")).toBe("b");
    expect(siguienteTrasQuitar(lista, "c")).toBe("b");
    expect(siguienteTrasQuitar([{ id: "a" }], "a")).toBeNull();
    expect(siguienteTrasQuitar(lista, "zz")).toBe("a");
  });

  it("junta las modelos de lo cargado con las ya conocidas, por nombre", () => {
    const modelos = modelosDeLaCola(
      [
        post({ employee: { id: "e2", nombreArtistico: "Zoe", fotoPerfilUrl: null } }),
        post({ employee: { id: "e1", nombreArtistico: "Ámbar", fotoPerfilUrl: null } }),
      ],
      [{ id: "e3", nombre: "Luna" }],
    );
    expect(modelos.map((m) => m.nombre)).toEqual(["Ámbar", "Luna", "Zoe"]);
  });

  it("cuenta pendientes sin inventar el total cuando hay mas paginas", () => {
    const pocos = contarPendientes({ items: [post()], nextCursor: null });
    expect(textoCortoDelContador(pocos)).toBe("1");
    expect(textoDelContador(pocos)).toBe("1 publicación por revisar");

    const muchos = contarPendientes({
      items: Array.from({ length: 50 }, (_, i) => post({ id: String(i) })),
      nextCursor: "x",
    });
    expect(textoCortoDelContador(muchos)).toBe("50+");
    expect(textoDelContador(muchos)).toBe("Más de 50 publicaciones por revisar");
    expect(textoDelContador({ cantidad: 0, hayMas: false })).toBe("Sin publicaciones por revisar");
  });
});

describe("queRecargarPorEvento", () => {
  const evento = { type: "post_pending", data: { postId: "p1", employeeId: "e1", eventId: "ev" } };

  it("un post nuevo en la cola relee la cola si se mira pendiente, y siempre el contador", () => {
    expect(queRecargarPorEvento(evento, "pendiente")).toEqual({ cola: true, contador: true });
    expect(queRecargarPorEvento(evento, "aprobado")).toEqual({ cola: false, contador: true });
    expect(queRecargarPorEvento(evento, null)).toEqual({ cola: false, contador: true });
  });

  it("ignora otros eventos y los que no traen postId", () => {
    expect(queRecargarPorEvento({ type: "message_created", data: { postId: "p1" } }, "pendiente")).toBeNull();
    expect(queRecargarPorEvento({ type: "post_approved", data: { postId: "p1" } }, "pendiente")).toBeNull();
    expect(queRecargarPorEvento({ type: "post_pending", data: {} }, "pendiente")).toBeNull();
    expect(queRecargarPorEvento({ type: "post_pending" }, "pendiente")).toBeNull();
  });
});

describe("traducirFalloDelPost", () => {
  it("un 409 muestra el texto del backend y marca conflicto", () => {
    expect(
      traducirFalloDelPost(
        {
          status: 409,
          message: "El post ya no está pendiente de revisión; otra persona pudo decidirlo antes",
        },
        "aprobar",
      ),
    ).toEqual({
      conflicto: true,
      error:
        "El post ya no está pendiente de revisión; otra persona pudo decidirlo antes. La cola se actualizó con su estado actual.",
    });
  });

  it("un 409 sin texto util tiene su propio mensaje", () => {
    const fallo = traducirFalloDelPost(
      { status: 409, message: "Backend request failed with status 409" },
      "archivar",
    );
    expect(fallo.conflicto).toBe(true);
    expect(fallo.error).toMatch(/^La publicación cambió/);
  });

  it("un 404 relee la cola y explica las dos causas posibles", () => {
    const fallo = traducirFalloDelPost({ status: 404, message: "Post no encontrado" }, "rechazar");
    expect(fallo.conflicto).toBe(true);
    expect(fallo.error).toMatch(/ya no existe o la modelo ya no está a tu cargo/);
  });

  it("un 400 al rechazar pide el motivo", () => {
    expect(
      traducirFalloDelPost({ status: 400, message: "Indica el motivo del rechazo" }, "rechazar"),
    ).toEqual({ error: "Escribe el motivo del rechazo, de 1 a 500 caracteres." });
  });

  it("permiso, ritmo y red", () => {
    expect(traducirFalloDelPost({ status: 403 }, "aprobar").error).toMatch(/permiso/);
    expect(traducirFalloDelPost({ status: 429 }, "aprobar").error).toMatch(/Espera unos segundos/);
    expect(traducirFalloDelPost(null, "aprobar").error).toMatch(/Revisa tu conexión/);
    expect(traducirFalloDelPost({ status: 500, message: "boom" }, "aprobar").conflicto).toBeUndefined();
  });
});
