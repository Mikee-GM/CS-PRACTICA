import type { EmployeeReportCategory } from "@/lib/types";

/** Una modelo del servicio; en un grupal hay una por participante. */
export type ModeloPorValorar = {
  id: string;
  nombreArtistico: string;
  /** `null` mientras el cliente no la haya calificado. */
  estrellas: number | null;
};

/** Lo que `GET /client-feedback/pending` devuelve por servicio (las fechas llegan como texto). */
export type ServicioPorValorar = {
  servicioId: string;
  finalizadoEn: string;
  grupal: boolean;
  modelos: ModeloPorValorar[];
  /** Ya reportadas: el indice unico del backend rechazaria repetirlas. */
  categoriasReportadas: EmployeeReportCategory[];
};

export type CalificacionDelCliente = {
  servicioId: string;
  empleadaId: string | null;
  estrellas: number;
};

export type MotivoDeCalificacion = "trato" | "puntualidad" | "comunicacion" | "otro";

export const MOTIVOS: ReadonlyArray<{ valor: MotivoDeCalificacion; etiqueta: string }> = [
  { valor: "trato", etiqueta: "Trato" },
  { valor: "puntualidad", etiqueta: "Puntualidad" },
  { valor: "comunicacion", etiqueta: "Comunicación" },
  { valor: "otro", etiqueta: "Otro" },
];

/** Mismo orden que `REPORT_CATEGORIES` del backend. */
export const CATEGORIAS_DE_REPORTE: readonly EmployeeReportCategory[] = [
  "trato_inadecuado",
  "demora_impuntualidad",
  "incumplimiento",
  "cobro",
  "seguridad",
  "otro",
];

/** Categorias que aun se pueden reportar en este servicio. */
export function categoriasDisponibles(
  servicio: Pick<ServicioPorValorar, "categoriasReportadas">,
): EmployeeReportCategory[] {
  return CATEGORIAS_DE_REPORTE.filter((c) => !servicio.categoriasReportadas.includes(c));
}

/** Con tres estrellas o menos se pregunta que paso, como hacia el bot. */
export function pideMotivo(estrellas: number): boolean {
  return estrellas <= 3;
}
