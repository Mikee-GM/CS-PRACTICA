/**
 * Identificador unico para el cliente (por ejemplo el de un mensaje).
 *
 * `crypto.randomUUID` solo existe en un contexto seguro: con HTTPS o `localhost`.
 * Abierto por HTTP desde otra maquina (el telefono contra la PC de desarrollo, o
 * una red interna sin certificado) no esta definido y el envio fallaba antes de
 * salir. `getRandomValues` si esta disponible en cualquier contexto.
 */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4 y variante RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}
