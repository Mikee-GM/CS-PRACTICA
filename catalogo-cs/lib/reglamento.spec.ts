import { estadoVisible, type MiReglamento } from "./reglamento";

function cuestionario(
  estado: "pending" | "in_progress" | "completed",
  intentos: number,
): NonNullable<MiReglamento["cuestionario"]> {
  return {
    estado,
    esRenovacion: false,
    intentos,
    mejorPuntaje: 0,
    aprobadoEn: null,
    pregunta: null,
  };
}

describe("estadoVisible", () => {
  it("sin cuestionario es sin empezar", () => {
    expect(estadoVisible(null)).toBe("sin_empezar");
  });

  it("completado es aprobado", () => {
    expect(estadoVisible(cuestionario("completed", 1))).toBe("aprobado");
  });

  it("en progreso es en curso", () => {
    expect(estadoVisible(cuestionario("in_progress", 0))).toBe("en_curso");
  });

  it("pendiente sin intentos es sin empezar", () => {
    expect(estadoVisible(cuestionario("pending", 0))).toBe("sin_empezar");
  });

  it("pendiente con intentos es reprobado", () => {
    expect(estadoVisible(cuestionario("pending", 2))).toBe("reprobado");
  });
});
