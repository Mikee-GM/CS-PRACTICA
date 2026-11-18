import {
  categoriasDisponibles,
  CATEGORIAS_DE_REPORTE,
  MOTIVOS,
  pideMotivo,
} from "./valoracion-del-servicio";

describe("pideMotivo", () => {
  it("pide motivo con tres estrellas o menos", () => {
    expect([1, 2, 3].map(pideMotivo)).toEqual([true, true, true]);
  });

  it("no lo pide con cuatro o cinco", () => {
    expect([4, 5].map(pideMotivo)).toEqual([false, false]);
  });
});

describe("categoriasDisponibles", () => {
  it("ofrece todas si no hay reportes", () => {
    expect(categoriasDisponibles({ categoriasReportadas: [] })).toEqual(CATEGORIAS_DE_REPORTE);
  });

  it("quita las ya reportadas", () => {
    expect(categoriasDisponibles({ categoriasReportadas: ["cobro", "otro"] })).toEqual([
      "trato_inadecuado",
      "demora_impuntualidad",
      "incumplimiento",
      "seguridad",
    ]);
  });

  it("queda vacia si se reportaron todas", () => {
    expect(
      categoriasDisponibles({ categoriasReportadas: [...CATEGORIAS_DE_REPORTE] }),
    ).toEqual([]);
  });
});

describe("MOTIVOS", () => {
  it("coincide con los motivos del backend", () => {
    expect(MOTIVOS.map((m) => m.valor)).toEqual(["trato", "puntualidad", "comunicacion", "otro"]);
  });
});
