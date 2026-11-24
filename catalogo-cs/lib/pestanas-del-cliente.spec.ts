import { direccionDeLaPestana, indiceDePestana } from "./pestanas-del-cliente";

describe("indiceDePestana", () => {
  it("sigue el orden de la barra y acepta subrutas", () => {
    expect(indiceDePestana("/feed")).toBe(0);
    expect(indiceDePestana("/chats")).toBe(1);
    expect(indiceDePestana("/chats/abc")).toBe(1);
    expect(indiceDePestana("/cuenta")).toBe(2);
  });

  it("devuelve null fuera de la barra", () => {
    expect(indiceDePestana("/")).toBeNull();
    expect(indiceDePestana("/chatsx")).toBeNull();
  });
});

describe("direccionDeLaPestana", () => {
  it("entra desde la derecha al avanzar y desde la izquierda al retroceder", () => {
    expect(direccionDeLaPestana(0, 2)).toBe(1);
    expect(direccionDeLaPestana(2, 1)).toBe(-1);
  });

  it("no mueve nada sin origen conocido o en la misma pestana", () => {
    expect(direccionDeLaPestana(null, 1)).toBe(0);
    expect(direccionDeLaPestana(1, 1)).toBe(0);
    expect(direccionDeLaPestana(1, null)).toBe(0);
  });
});
