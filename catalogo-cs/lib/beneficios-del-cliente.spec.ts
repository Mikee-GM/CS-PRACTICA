import {
  aplazarHasta,
  debeMostrarElAnuncio,
  debeReclamar,
  DIAS_SIN_INSISTIR,
  esRutaDeConversacion,
  leerAplazamiento,
} from "./beneficios-del-cliente";

const base = {
  estado: "sin_reclamar" as const,
  instalada: false,
  ruta: "/chats",
  aplazadoHasta: null,
  ahora: 1_000_000,
};

describe("debeMostrarElAnuncio", () => {
  it("anuncia a quien esta en el navegador y no lo tiene", () => {
    expect(debeMostrarElAnuncio(base)).toBe(true);
  });

  it("no anuncia si ya esta instalada ni si el beneficio ya se otorgo", () => {
    expect(debeMostrarElAnuncio({ ...base, instalada: true })).toBe(false);
    for (const estado of ["disponible", "usado", "caducado"] as const) {
      expect(debeMostrarElAnuncio({ ...base, estado })).toBe(false);
    }
  });

  it("no tapa una conversacion", () => {
    expect(debeMostrarElAnuncio({ ...base, ruta: "/chats/abc-123" })).toBe(false);
    expect(debeMostrarElAnuncio({ ...base, ruta: "/feed" })).toBe(true);
  });

  it("respeta el aplazamiento y vuelve cuando termina", () => {
    expect(debeMostrarElAnuncio({ ...base, aplazadoHasta: base.ahora + 1 })).toBe(false);
    expect(debeMostrarElAnuncio({ ...base, aplazadoHasta: base.ahora })).toBe(true);
  });
});

describe("debeReclamar", () => {
  it("solo con la app instalada y el beneficio sin otorgar", () => {
    expect(debeReclamar({ estado: "sin_reclamar", instalada: true })).toBe(true);
    expect(debeReclamar({ estado: "sin_reclamar", instalada: false })).toBe(false);
    expect(debeReclamar({ estado: "disponible", instalada: true })).toBe(false);
  });
});

describe("aplazamiento", () => {
  it("suma los dias sin insistir", () => {
    expect(aplazarHasta(0)).toBe(DIAS_SIN_INSISTIR * 86_400_000);
  });

  it("ignora un valor guardado que no es una fecha", () => {
    expect(leerAplazamiento(null)).toBeNull();
    expect(leerAplazamiento("hola")).toBeNull();
    expect(leerAplazamiento("-5")).toBeNull();
    expect(leerAplazamiento("1700000000000")).toBe(1_700_000_000_000);
  });
});

describe("esRutaDeConversacion", () => {
  it("distingue la bandeja de una conversacion", () => {
    expect(esRutaDeConversacion("/chats")).toBe(false);
    expect(esRutaDeConversacion("/chats/x")).toBe(true);
    expect(esRutaDeConversacion("/cuenta")).toBe(false);
  });
});
