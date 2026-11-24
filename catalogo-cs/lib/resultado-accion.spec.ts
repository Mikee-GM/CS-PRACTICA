import { desenvolver } from "./resultado-accion";

describe("desenvolver", () => {
  it("devuelve el dato cuando la accion salio bien", async () => {
    await expect(
      desenvolver(Promise.resolve({ ok: true as const, data: 42 })),
    ).resolves.toBe(42);
  });

  it("lanza un Error normal con el motivo en espanol cuando fallo", async () => {
    await expect(
      desenvolver(
        Promise.resolve({ ok: false as const, error: "El enlace no es valido." }),
      ),
    ).rejects.toThrow("El enlace no es valido.");
  });
});
