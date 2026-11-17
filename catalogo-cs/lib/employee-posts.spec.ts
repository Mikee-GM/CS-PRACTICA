import {
  accionesDisponibles,
  anuncioTrasMover,
  avisoAlBorrar,
  avisoDelEditor,
  AVISO_EDITAR_PUBLICADA,
  cabeEnUnaPeticion,
  conPostActualizado,
  contadorDelTexto,
  cupoRestante,
  dimensionValida,
  duracionCorta,
  duracionEnMs,
  editarPideConfirmacion,
  etiquetaDeEstado,
  LIMITE_POR_PETICION,
  MARGEN_DEL_MULTIPART,
  megas,
  mensajeDelBackend,
  mensajeTrasBorrar,
  momentoDeLaPortada,
  motivoPendienteDeCorregir,
  moverEnLista,
  paginaDeMisPosts,
  revisarArchivo,
  tamanoDeLaPortada,
  traducirFallo,
  unirMisPosts,
  type PostDeLaModelo,
} from "./employee-posts";
import type { MediaDelPost } from "./posts";

const MB = 1024 * 1024;

function media(kind: "imagen" | "video", id: string = kind): MediaDelPost {
  return {
    id,
    kind,
    url: `https://x.r2.dev/${id}`,
    posterUrl: kind === "video" ? `https://x.r2.dev/${id}.jpg` : null,
    width: 1080,
    height: 1350,
    durationMs: kind === "video" ? 12_000 : null,
    position: 0,
  };
}

function post(parcial: Partial<PostDeLaModelo> = {}): PostDeLaModelo {
  return {
    id: "p1",
    caption: "",
    status: "borrador",
    rejectionReason: null,
    submittedAt: null,
    publishedAt: null,
    createdAt: "2026-11-17T18:00:00.000Z",
    likeCount: 0,
    media: [],
    ...parcial,
  };
}

describe("etiquetaDeEstado", () => {
  it.each([
    ["borrador", "Borrador"],
    ["pendiente", "En revisión"],
    ["aprobado", "Publicada"],
  ] as const)("%s se lee como %s", (status, texto) => {
    expect(etiquetaDeEstado({ status, rejectionReason: null }).texto).toBe(texto);
  });

  it("un rechazado lleva su motivo en la etiqueta", () => {
    expect(
      etiquetaDeEstado({ status: "rechazado", rejectionReason: " Foto borrosa " }),
    ).toEqual({ texto: "Rechazada: Foto borrosa", tono: "rechazada" });
  });

  it("un rechazado sin motivo no deja dos puntos colgando", () => {
    expect(etiquetaDeEstado({ status: "rechazado", rejectionReason: "  " }).texto).toBe(
      "Rechazada",
    );
  });
});

describe("motivoPendienteDeCorregir", () => {
  it("un borrador que viene de un rechazo conserva el motivo", () => {
    expect(
      motivoPendienteDeCorregir({ status: "borrador", rejectionReason: "Sin rostro" }),
    ).toBe("Sin rostro");
  });

  it("en cualquier otro estado no hay nada pendiente", () => {
    expect(
      motivoPendienteDeCorregir({ status: "pendiente", rejectionReason: "Sin rostro" }),
    ).toBeNull();
    expect(motivoPendienteDeCorregir({ status: "borrador", rejectionReason: null })).toBeNull();
  });
});

describe("accionesDisponibles", () => {
  it("un borrador sin media no se puede enviar todavia", () => {
    expect(accionesDisponibles(post())).toEqual({
      editar: true,
      enviar: false,
      borrar: "eliminar",
    });
  });

  it("un borrador o un rechazado con media se envian y se eliminan", () => {
    for (const status of ["borrador", "rechazado"] as const) {
      expect(accionesDisponibles(post({ status, media: [media("imagen")] }))).toEqual({
        editar: true,
        enviar: true,
        borrar: "eliminar",
      });
    }
  });

  it("pendiente y aprobado se editan pero se archivan en vez de borrarse", () => {
    for (const status of ["pendiente", "aprobado"] as const) {
      expect(accionesDisponibles(post({ status, media: [media("imagen")] }))).toEqual({
        editar: true,
        enviar: false,
        borrar: "archivar",
      });
    }
  });

  it("un archivado no admite nada", () => {
    expect(accionesDisponibles(post({ status: "archivado" }))).toEqual({
      editar: false,
      enviar: false,
      borrar: null,
    });
  });
});

describe("avisos de edicion y borrado", () => {
  it("solo un publicado pide confirmar antes de editarlo", () => {
    expect(editarPideConfirmacion("aprobado")).toBe(true);
    for (const status of ["borrador", "pendiente", "rechazado"] as const) {
      expect(editarPideConfirmacion(status)).toBe(false);
    }
  });

  it("el aviso del publicado dice que sale del feed hasta nueva aprobacion", () => {
    expect(avisoDelEditor("aprobado")).toBe(AVISO_EDITAR_PUBLICADA);
    expect(AVISO_EDITAR_PUBLICADA).toMatch(/dejará de verse hasta que coordinación la apruebe/);
    expect(avisoDelEditor("borrador")).toBeNull();
    expect(avisoDelEditor("rechazado")).toMatch(/volverá a borrador/);
  });

  it("borrador y rechazado se eliminan definitivamente", () => {
    for (const status of ["borrador", "rechazado"] as const) {
      const aviso = avisoAlBorrar(status);
      expect(aviso?.descripcion).toMatch(/Se eliminará definitivamente/);
      expect(aviso?.etiquetaConfirmar).toBe("Eliminar");
    }
  });

  it("pendiente y aprobado se archivan y dejan de verse", () => {
    expect(avisoAlBorrar("aprobado")?.descripcion).toMatch(/Se archivará y dejará de verse/);
    expect(avisoAlBorrar("pendiente")?.etiquetaConfirmar).toBe("Archivar");
    expect(avisoAlBorrar("archivado")).toBeNull();
  });

  it("el mensaje final sigue a lo que hizo el backend, no a lo que se pidio", () => {
    expect(mensajeTrasBorrar("archivado")).toMatch(/archivada/);
    expect(mensajeTrasBorrar("borrado")).toMatch(/eliminada/);
  });
});

describe("traducirFallo", () => {
  it("sin respuesta pide revisar la conexion", () => {
    expect(traducirFallo("subir", null)).toMatch(/conexión/);
  });

  it("un 413 explica como reducir el video", () => {
    expect(traducirFallo("subir", 413)).toMatch(/recórtalo/);
  });

  it("un 400 usa el texto del backend, que sabe que limite se rompio", () => {
    expect(
      traducirFallo("subir", 400, "Un post admite como máximo 3 videos"),
    ).toBe("Un post admite como máximo 3 videos");
  });

  it("un 400 sin texto al enviar recuerda que hace falta media", () => {
    expect(traducirFallo("enviar", 400)).toMatch(/al menos una foto/);
  });

  it("un 409 manda a recargar en vez de repetir el texto del backend", () => {
    const mensaje = traducirFallo("guardar-texto", 409, "Un post archivado no se puede editar");
    expect(mensaje).toMatch(/Vuelve a la lista/);
    expect(traducirFallo("enviar", 409)).toMatch(/ya está en revisión/);
  });

  it("un 404 al listar no es lo mismo que un 404 de un post", () => {
    expect(traducirFallo("listar", 404)).toMatch(/ficha de modelo/);
    expect(traducirFallo("borrar", 404)).toMatch(/ya no existe/);
  });

  it("un 429 pide esperar", () => {
    expect(traducirFallo("subir", 429)).toMatch(/Espera un minuto/);
  });
});

describe("mensajeDelBackend", () => {
  it("acepta texto o lista de textos y descarta lo demas", () => {
    expect(mensajeDelBackend({ message: "Falta algo" })).toBe("Falta algo");
    expect(mensajeDelBackend({ message: ["Uno", "", "Dos"] })).toBe("Uno. Dos");
    expect(mensajeDelBackend({ message: 3 })).toBeNull();
    expect(mensajeDelBackend(null)).toBeNull();
  });
});

describe("limites antes de subir", () => {
  it("el total del video y su portada tiene que caber en una peticion", () => {
    const portada = 200 * 1024;
    expect(cabeEnUnaPeticion(10 * MB, portada)).toBe(true);
    expect(cabeEnUnaPeticion(LIMITE_POR_PETICION - MARGEN_DEL_MULTIPART - portada, portada)).toBe(
      true,
    );
    expect(cabeEnUnaPeticion(LIMITE_POR_PETICION - portada, portada)).toBe(false);
  });

  it("megas sin decimales cuando es exacto", () => {
    expect(megas(20 * MB)).toBe("20");
    expect(megas(19.64 * MB)).toBe("19.6");
  });

  it("duracionEnMs descarta Infinity y ceros", () => {
    expect(duracionEnMs(12.3456)).toBe(12_346);
    expect(duracionEnMs(Infinity)).toBeNull();
    expect(duracionEnMs(Number.NaN)).toBeNull();
    expect(duracionEnMs(0)).toBeNull();
  });

  it("la portada sale de medio segundo, o de la mitad si el video es mas corto", () => {
    expect(momentoDeLaPortada(12)).toBe(0.5);
    expect(momentoDeLaPortada(0.4)).toBeCloseTo(0.2);
    expect(momentoDeLaPortada(Number.NaN)).toBe(0);
  });

  it("la portada conserva la proporcion y no pasa del lado maximo", () => {
    expect(tamanoDeLaPortada(1920, 1080)).toEqual({ ancho: 1280, alto: 720 });
    expect(tamanoDeLaPortada(720, 1280)).toEqual({ ancho: 720, alto: 1280 });
    expect(tamanoDeLaPortada(640, 480)).toEqual({ ancho: 640, alto: 480 });
    expect(tamanoDeLaPortada(0, 480)).toBeNull();
  });

  it("dimensionValida solo deja enteros entre 1 y 20000", () => {
    expect(dimensionValida(1079.6)).toBe(1080);
    expect(dimensionValida(0)).toBeNull();
    expect(dimensionValida(30_000)).toBeNull();
    expect(dimensionValida(undefined)).toBeNull();
  });

  it("cupoRestante cuenta medias y videos", () => {
    expect(cupoRestante([media("imagen"), media("video"), media("video", "v2")])).toEqual({
      medias: 7,
      videos: 1,
    });
  });
});

describe("revisarArchivo", () => {
  const libre = { medias: 10, videos: 3 };

  it("una foto comprimida pasa", () => {
    expect(revisarArchivo({ nombre: "a.jpg", tipo: "image/jpeg", bytes: MB }, libre)).toEqual({
      ok: true,
      kind: "imagen",
    });
  });

  it("un tipo no admitido se rechaza con el nombre del archivo", () => {
    const r = revisarArchivo({ nombre: "a.gif", tipo: "image/gif", bytes: MB }, libre);
    expect(r).toEqual({ ok: false, mensaje: expect.stringContaining('"a.gif"') });
  });

  it("sin cupo de medias no se sube nada", () => {
    const r = revisarArchivo(
      { nombre: "a.jpg", tipo: "image/jpeg", bytes: MB },
      { medias: 0, videos: 3 },
    );
    expect(r.ok).toBe(false);
  });

  it("sin cupo de videos se rechaza el video pero no una foto", () => {
    const sinVideos = { medias: 5, videos: 0 };
    expect(
      revisarArchivo(
        { nombre: "v.mp4", tipo: "video/mp4", bytes: MB, duracionMs: 5000, bytesPortada: 1000 },
        sinVideos,
      ),
    ).toEqual({ ok: false, mensaje: expect.stringMatching(/hasta 3 videos/) });
    expect(
      revisarArchivo({ nombre: "a.jpg", tipo: "image/jpeg", bytes: MB }, sinVideos).ok,
    ).toBe(true);
  });

  it("un video de mas de 20 MB se rechaza diciendo como corregirlo", () => {
    const r = revisarArchivo(
      { nombre: "v.mp4", tipo: "video/mp4", bytes: 25 * MB, duracionMs: 5000, bytesPortada: 1000 },
      libre,
    );
    expect(r).toEqual({
      ok: false,
      mensaje: expect.stringMatching(/pesa 25 MB y el máximo es 20 MB\. Recórtalo/),
    });
  });

  it("un video que con su portada no cabe en la peticion tambien se rechaza", () => {
    const r = revisarArchivo(
      {
        nombre: "v.mp4",
        tipo: "video/mp4",
        bytes: 20 * MB - 10 * 1024,
        duracionMs: 5000,
        bytesPortada: 300 * 1024,
      },
      libre,
    );
    expect(r.ok).toBe(false);
  });

  it("un video de mas de 30 segundos se rechaza", () => {
    const r = revisarArchivo(
      { nombre: "v.mp4", tipo: "video/mp4", bytes: MB, duracionMs: 30_001, bytesPortada: 1000 },
      libre,
    );
    expect(r).toEqual({ ok: false, mensaje: expect.stringMatching(/dura 31 segundos/) });
  });

  it("un video sin duracion legible no se sube", () => {
    const r = revisarArchivo(
      { nombre: "v.webm", tipo: "video/webm", bytes: MB, duracionMs: null, bytesPortada: 1000 },
      libre,
    );
    expect(r).toEqual({ ok: false, mensaje: expect.stringMatching(/duración/) });
  });

  it("un video valido pasa", () => {
    expect(
      revisarArchivo(
        { nombre: "v.mov", tipo: "video/quicktime", bytes: 8 * MB, duracionMs: 29_000, bytesPortada: 1000 },
        libre,
      ),
    ).toEqual({ ok: true, kind: "video" });
  });
});

describe("orden de la media", () => {
  it("sube y baja un puesto", () => {
    expect(moverEnLista(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moverEnLista(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("en los bordes no hay cambio que mandar", () => {
    expect(moverEnLista(["a", "b"], 0, -1)).toBeNull();
    expect(moverEnLista(["a", "b"], 1, 1)).toBeNull();
    expect(moverEnLista(["a"], 5, -1)).toBeNull();
  });

  it("no muta la lista original", () => {
    const original = ["a", "b"];
    moverEnLista(original, 0, 1);
    expect(original).toEqual(["a", "b"]);
  });

  it("anuncia la posicion resultante", () => {
    expect(anuncioTrasMover("imagen", 0, 4)).toBe("Foto movida a la posición 1 de 4.");
    expect(anuncioTrasMover("video", 2, 3)).toBe("Video movido a la posición 3 de 3.");
  });

  it("duracionCorta pinta minutos y segundos", () => {
    expect(duracionCorta(12_400)).toBe("0:12");
    expect(duracionCorta(65_000)).toBe("1:05");
    expect(duracionCorta(null)).toBeNull();
  });
});

describe("lista", () => {
  it("conPostActualizado reemplaza en su sitio o pone primero uno nuevo", () => {
    const a = post({ id: "a" });
    const b = post({ id: "b" });
    const b2 = post({ id: "b", caption: "nuevo" });
    expect(conPostActualizado([a, b], b2)).toEqual([a, b2]);
    expect(conPostActualizado([a], b)).toEqual([b, a]);
  });

  it("unirMisPosts no duplica", () => {
    const a = post({ id: "a" });
    const b = post({ id: "b" });
    expect(unirMisPosts([a], [a, b, b]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("paginaDeMisPosts lee vacio lo que no tiene forma y descarta archivados", () => {
    expect(paginaDeMisPosts(null)).toEqual({ items: [], nextCursor: null });
    const pagina = paginaDeMisPosts({
      items: [post({ id: "a" }), post({ id: "z", status: "archivado" })],
      nextCursor: "c",
    });
    expect(pagina.items.map((p) => p.id)).toEqual(["a"]);
    expect(pagina.nextCursor).toBe("c");
  });

  it("contadorDelTexto", () => {
    expect(contadorDelTexto("hola")).toBe("4 / 2000");
  });
});
