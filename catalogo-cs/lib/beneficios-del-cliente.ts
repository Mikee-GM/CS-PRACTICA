/**
 * Reglas puras del descuento por instalar la app, aparte de los componentes para
 * poder probarlas sin DOM.
 */

export type EstadoDelBeneficio = "sin_reclamar" | "disponible" | "usado" | "caducado";

export type BeneficioDeInstalacion = {
  estado: EstadoDelBeneficio;
  porcentaje: number;
  /** ISO; solo si ya se otorgo. */
  caducaAt: string | null;
};

/** Donde se recuerda que el cliente pospuso el anuncio. */
export const CLAVE_DE_APLAZAMIENTO = "cs-anuncio-instalacion";
/** Dias que se deja tranquilo al cliente despues de decir "ahora no". */
export const DIAS_SIN_INSISTIR = 3;

/** Dentro de una conversacion el anuncio taparia la barra de escritura. */
export function esRutaDeConversacion(ruta: string): boolean {
  return /^\/chats\/[^/]+/.test(ruta);
}

/**
 * Se reclama solo cuando la sesion corre como app instalada y todavia no se
 * otorgo: abrirla instalada es lo que activa el descuento.
 */
export function debeReclamar(entorno: {
  estado: EstadoDelBeneficio;
  instalada: boolean;
}): boolean {
  return entorno.instalada && entorno.estado === "sin_reclamar";
}

/**
 * Se anuncia a quien esta en el navegador y aun no lo tiene, fuera de las
 * conversaciones y sin insistir mientras dure el aplazamiento.
 */
export function debeMostrarElAnuncio(entorno: {
  estado: EstadoDelBeneficio;
  instalada: boolean;
  ruta: string;
  /** Marca de tiempo (ms) hasta la que el cliente pidio no ver el anuncio. */
  aplazadoHasta: number | null;
  ahora: number;
}): boolean {
  if (entorno.instalada || entorno.estado !== "sin_reclamar") return false;
  if (esRutaDeConversacion(entorno.ruta)) return false;
  return entorno.aplazadoHasta === null || entorno.ahora >= entorno.aplazadoHasta;
}

export function aplazarHasta(ahora: number): number {
  return ahora + DIAS_SIN_INSISTIR * 86_400_000;
}

/** `aplazadoHasta` guardado, o `null` si no hay o esta corrupto. */
export function leerAplazamiento(valor: string | null): number | null {
  if (!valor) return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}
