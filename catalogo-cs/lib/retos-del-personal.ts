/*
 * Retos propios de la empleada o el chofer (`GET /challenges/mine`). Vive
 * aparte de `lib/types.ts` porque lo consume un componente generico que no
 * depende de ningun portal.
 */

export type MetricaDeReto = "kpi_score" | "services" | "revenue";

export type EstadoDeReto = "active" | "finished";

export type PuestoDelTop = {
  posicion: number;
  nombre: string;
  valor: number;
  esMio: boolean;
};

export type RetoDelPersonal = {
  id: string;
  title: string;
  metric: MetricaDeReto;
  status: EstadoDeReto;
  startsAt: string;
  endsAt: string;
  participantes: number;
  miPosicion: number | null;
  miValor: number;
  gane: boolean;
  top: PuestoDelTop[];
};

export const ETIQUETA_DE_METRICA: Record<MetricaDeReto, string> = {
  kpi_score: "Puntaje de desempeño",
  services: "Servicios completados",
  revenue: "Ingresos generados",
};
