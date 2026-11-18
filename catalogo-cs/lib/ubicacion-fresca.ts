import type { Driver } from "@/lib/types";

/**
 * Minutos que una posicion se considera al dia. Replica el umbral del backend
 * (`ubicacionVieja`): si uno cambia sin el otro, el panel y el despacho
 * discreparian sobre quien esta localizable.
 */
export const MINUTOS_DE_UBICACION_FRESCA = 15;

type ConUbicacion = Pick<Driver, "ultimaUbicacionAt" | "ubicacionVieja">;

/**
 * Si la posicion del chofer ya no sirve para despachar.
 *
 * Manda la bandera del backend cuando viene, porque es la que usa el despacho.
 * El calculo local solo cubre lo que se actualiza en vivo por SSE o las
 * respuestas que no la traen. Sin marca de tiempo cuenta como vieja: no hay
 * forma de afirmar que este al dia.
 */
export function ubicacionEstaVieja(driver: ConUbicacion, ahora: Date): boolean {
  if (typeof driver.ubicacionVieja === "boolean") return driver.ubicacionVieja;
  if (!driver.ultimaUbicacionAt) return true;

  const marca = new Date(driver.ultimaUbicacionAt).getTime();
  if (Number.isNaN(marca)) return true;

  return (
    ahora.getTime() - marca > MINUTOS_DE_UBICACION_FRESCA * 60_000
  );
}

/** Texto corto de cuanto hace que se reporto la posicion. */
export function antiguedadDeUbicacion(
  iso: string | null | undefined,
  ahora: Date,
): string {
  if (!iso) return "Sin registro";
  const marca = new Date(iso).getTime();
  if (Number.isNaN(marca)) return "Sin registro";

  const minutos = Math.max(0, Math.floor((ahora.getTime() - marca) / 60_000));
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  return `hace ${Math.floor(horas / 24)} d`;
}
