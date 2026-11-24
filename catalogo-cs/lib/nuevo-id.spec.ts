import { nuevoId } from "./nuevo-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("nuevoId", () => {
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");

  afterEach(() => {
    if (original) Object.defineProperty(crypto, "randomUUID", original);
  });

  it("genera un UUID v4", () => {
    expect(nuevoId()).toMatch(UUID_V4);
  });

  it("genera un UUID v4 valido sin randomUUID, como en HTTP sobre una IP", () => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    const a = nuevoId();
    expect(a).toMatch(UUID_V4);
    expect(nuevoId()).not.toBe(a);
  });
});
