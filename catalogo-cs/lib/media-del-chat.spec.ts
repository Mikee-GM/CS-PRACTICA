import {
  errorDeMedia,
  formatearDuracion,
  formatoDeGrabacion,
  mensajeDeMicrofono,
  motivoSinMicrofono,
} from "./media-del-chat";

describe("formatearDuracion", () => {
  it("da minutos y segundos con dos cifras", () => {
    expect(formatearDuracion(65_000)).toBe("1:05");
    expect(formatearDuracion(9_400)).toBe("0:09");
    expect(formatearDuracion(300_000)).toBe("5:00");
  });

  it("no rompe con valores que un audio sin metadatos puede dar", () => {
    expect(formatearDuracion(undefined)).toBe("0:00");
    expect(formatearDuracion(NaN)).toBe("0:00");
    expect(formatearDuracion(Infinity)).toBe("0:00");
    expect(formatearDuracion(-5)).toBe("0:00");
  });
});

describe("formatoDeGrabacion", () => {
  it("elige WebM donde se puede y MP4 en Safari", () => {
    expect(formatoDeGrabacion(() => true)?.mime).toBe("audio/webm;codecs=opus");
    expect(formatoDeGrabacion((m) => m === "audio/mp4")).toEqual({
      mime: "audio/mp4",
      extension: "m4a",
    });
  });

  it("devuelve null si ninguno sirve", () => {
    expect(formatoDeGrabacion(() => false)).toBeNull();
  });
});

describe("motivoSinMicrofono", () => {
  it("pide https fuera de un contexto seguro, que es el caso de abrirlo por IP en http", () => {
    expect(
      motivoSinMicrofono({ contextoSeguro: false, tieneGetUserMedia: false, tieneMediaRecorder: true }),
    ).toMatch(/https/);
  });

  it("no pone objeciones cuando todo esta disponible", () => {
    expect(
      motivoSinMicrofono({ contextoSeguro: true, tieneGetUserMedia: true, tieneMediaRecorder: true }),
    ).toBeNull();
  });
});

describe("mensajeDeMicrofono", () => {
  it("dice que hacer en cada caso", () => {
    expect(mensajeDeMicrofono("NotAllowedError")).toMatch(/permiso/);
    expect(mensajeDeMicrofono("NotFoundError")).toMatch(/micrófono/);
    expect(mensajeDeMicrofono("algo raro")).toMatch(/Vuelve a intentarlo/);
  });
});

describe("errorDeMedia", () => {
  it("acepta una foto y un audio normales", () => {
    expect(errorDeMedia({ kind: "foto", type: "image/jpeg", size: 1_000_000 })).toBeNull();
    expect(errorDeMedia({ kind: "audio", type: "audio/webm", size: 200_000 })).toBeNull();
  });

  it("rechaza vacios, formatos de foto raros y pesos excesivos", () => {
    expect(errorDeMedia({ kind: "foto", type: "image/jpeg", size: 0 })).toMatch(/vacío/);
    expect(errorDeMedia({ kind: "foto", type: "image/heic", size: 100 })).toMatch(/JPEG/);
    expect(errorDeMedia({ kind: "foto", type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(errorDeMedia({ kind: "audio", type: "audio/webm", size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
  });
});
