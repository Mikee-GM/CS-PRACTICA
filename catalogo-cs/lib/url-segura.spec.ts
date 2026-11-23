import { urlWebSegura } from "./url-segura";

describe("urlWebSegura", () => {
  it("deja pasar http y https", () => {
    expect(urlWebSegura("https://x.com/valentina")).toBe("https://x.com/valentina");
    expect(urlWebSegura("http://localhost:9000/a.png")).toBe("http://localhost:9000/a.png");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//x.com/sin-protocolo",
    "no es una url",
    "",
  ])("rechaza %s", (valor) => {
    expect(urlWebSegura(valor)).toBeNull();
  });

  it("rechaza nulos", () => {
    expect(urlWebSegura(null)).toBeNull();
    expect(urlWebSegura(undefined)).toBeNull();
  });
});
