import {
  antiguedadDeUbicacion,
  MINUTOS_DE_UBICACION_FRESCA,
  ubicacionEstaVieja,
} from "./ubicacion-fresca";

const ahora = new Date("2026-06-01T12:00:00.000Z");
const haceMin = (min: number) =>
  new Date(ahora.getTime() - min * 60_000).toISOString();

describe("ubicacionEstaVieja", () => {
  it("usa la bandera del backend cuando viene", () => {
    expect(
      ubicacionEstaVieja(
        { ubicacionVieja: false, ultimaUbicacionAt: haceMin(90) },
        ahora,
      ),
    ).toBe(false);
    expect(
      ubicacionEstaVieja(
        { ubicacionVieja: true, ultimaUbicacionAt: haceMin(1) },
        ahora,
      ),
    ).toBe(true);
  });

  it("sin bandera calcula desde la marca de tiempo", () => {
    expect(ubicacionEstaVieja({ ultimaUbicacionAt: haceMin(5) }, ahora)).toBe(
      false,
    );
    expect(
      ubicacionEstaVieja(
        { ultimaUbicacionAt: haceMin(MINUTOS_DE_UBICACION_FRESCA) },
        ahora,
      ),
    ).toBe(false);
    expect(ubicacionEstaVieja({ ultimaUbicacionAt: haceMin(16) }, ahora)).toBe(
      true,
    );
  });

  it("una marca nula o invalida cuenta como vieja", () => {
    expect(ubicacionEstaVieja({ ultimaUbicacionAt: null }, ahora)).toBe(true);
    expect(ubicacionEstaVieja({}, ahora)).toBe(true);
    expect(ubicacionEstaVieja({ ultimaUbicacionAt: "no-fecha" }, ahora)).toBe(
      true,
    );
  });
});

describe("antiguedadDeUbicacion", () => {
  it("formatea minutos, horas y dias", () => {
    expect(antiguedadDeUbicacion(haceMin(7), ahora)).toBe("hace 7 min");
    expect(antiguedadDeUbicacion(haceMin(120), ahora)).toBe("hace 2 h");
    expect(antiguedadDeUbicacion(haceMin(60 * 50), ahora)).toBe("hace 2 d");
    expect(antiguedadDeUbicacion(haceMin(0), ahora)).toBe("hace un momento");
  });

  it("sin marca devuelve Sin registro", () => {
    expect(antiguedadDeUbicacion(null, ahora)).toBe("Sin registro");
    expect(antiguedadDeUbicacion(undefined, ahora)).toBe("Sin registro");
  });
});
