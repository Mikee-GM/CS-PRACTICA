import { enlaceDeEvaluacion, TOKEN_CANDIDATA } from "./candidata";

describe("enlaceDeEvaluacion", () => {
  it("arma la ruta publica con el origen recibido", () => {
    expect(enlaceDeEvaluacion("https://sitio.mx", "abc_DEF-123")).toBe(
      "https://sitio.mx/candidata/abc_DEF-123",
    );
  });

  it("codifica el token para que no rompa la ruta", () => {
    expect(enlaceDeEvaluacion("https://sitio.mx", "a/b?c")).toBe(
      "https://sitio.mx/candidata/a%2Fb%3Fc",
    );
  });
});

describe("TOKEN_CANDIDATA", () => {
  it.each(["abcdefgh", "Ab_-1234567890", "a".repeat(64)])("acepta %s", (t) => {
    expect(TOKEN_CANDIDATA.test(t)).toBe(true);
  });

  it.each([
    "corto",
    "a".repeat(65),
    "con espacio1",
    "../etc/passwd",
    "ab/cdefgh",
    "",
  ])("rechaza %j", (t) => {
    expect(TOKEN_CANDIDATA.test(t)).toBe(false);
  });
});
