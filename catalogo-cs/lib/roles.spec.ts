import { inicioParaRol, puedeEntrarEn } from "./roles";

describe("inicioParaRol", () => {
  it.each([
    ["admin", "/admin/dashboard"],
    ["jefe", "/jefe"],
    ["empleada", "/empleada/portal"],
    ["chofer", "/chofer/portal"],
    // La red social es la portada del cliente; los chats quedan en su barra.
    ["cliente", "/feed"],
  ])("manda a %s a %s", (rol, destino) => {
    expect(inicioParaRol(rol)).toBe(destino);
  });

  it.each([null, undefined, "", "desconocido"])(
    "un rol ausente o desconocido (%p) va al login unico, nunca a un area interna",
    (rol) => {
      expect(inicioParaRol(rol)).toBe("/ingresar");
    },
  );
});

describe("puedeEntrarEn", () => {
  it("el cliente no entra en ningun area del personal", () => {
    expect(puedeEntrarEn("admin", "cliente")).toBe(false);
    expect(puedeEntrarEn("jefe", "cliente")).toBe(false);
  });

  it("el admin entra tambien en el area del jefe", () => {
    expect(puedeEntrarEn("jefe", "admin")).toBe(true);
    expect(puedeEntrarEn("admin", "jefe")).toBe(false);
  });
});
