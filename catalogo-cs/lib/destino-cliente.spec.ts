import { destinoSeguroDelCliente } from "./destino-cliente";

describe("destinoSeguroDelCliente", () => {
  it.each([
    ["/chats", "/chats"],
    ["/chats?modelo=0f4e2c1a-1b2c-4d5e-8f90-123456789abc", "/chats?modelo=0f4e2c1a-1b2c-4d5e-8f90-123456789abc"],
    ["/chats/0f4e2c1a-1b2c-4d5e-8f90-123456789abc", "/chats/0f4e2c1a-1b2c-4d5e-8f90-123456789abc"],
    ["/cuenta", "/cuenta"],
  ])("admite la pantalla del cliente %s", (entrada, esperado) => {
    expect(destinoSeguroDelCliente(entrada)).toBe(esperado);
  });

  it.each([
    "//otro-sitio.com/chats",
    "/\\otro-sitio.com",
    "https://otro-sitio.com/chats",
    "javascript:alert(1)",
    "/admin/dashboard",
    "/jefe",
    "/chatsx",
    "/chats/../admin",
    "/chats/%2e%2e/admin",
    "",
  ])("rechaza %s", (entrada) => {
    expect(destinoSeguroDelCliente(entrada)).toBeNull();
  });

  it("descarta los parametros que no conoce", () => {
    expect(destinoSeguroDelCliente("/chats?modelo=abc&otro=1")).toBe("/chats?modelo=abc");
    expect(destinoSeguroDelCliente("/chats?modelo=<script>")).toBe("/chats");
  });

  it("sin valor no hay destino", () => {
    expect(destinoSeguroDelCliente(null)).toBeNull();
    expect(destinoSeguroDelCliente(undefined)).toBeNull();
  });
});
