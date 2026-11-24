/**
 * Conciliacion de dinero: lo que devuelve `GET /liquidations/conciliacion`.
 *
 * El backend recalcula cada importe desde los servicios y lo compara con lo que
 * guardo en otra parte. Aqui solo viven los tipos y lo que hace falta para
 * presentarlo; no se recalcula nada en el navegador.
 */

export type CasoDeDiscrepancia = {
  referencia: string;
  servicioId: string | null;
  esperado: number;
  real: number;
  diferencia: number;
  detalle: string;
};

export type ResultadoDeVerificacion = {
  id: string;
  titulo: string;
  descripcion: string;
  estado: "ok" | "discrepancia";
  casos: number;
  diferenciaTotal: number;
  muestra: CasoDeDiscrepancia[];
};

export type ResumenDeDinero = {
  servicios: number;
  cobradoTotal: number;
  cobradoEnEfectivo: number;
  cobradoConTarjeta: number;
  cobradoPorTransferencia: number;
  base: number;
  extras: number;
  extrasConTarjeta: number;
  comisionExtrasTarjeta: number;
  transporteCobradoAlCliente: number;
  parteDeLaEmpresa: number;
  multasDelPeriodo: number;
  pagoAChoferes: number;
  pagoAChoferesLiquidado: number;
  pagoAChoferesPendiente: number;
  viajesDeChoferes: number;
  costoDeUber: number;
  efectivoPorCobrar: number;
  efectivoPorCobrarListo: number;
  efectivoPorCobrarProvisional: number;
  obligacionesAbiertas: number;
  abonosDeEfectivoDelPeriodo: number;
  deudasAbiertas: number;
  cortesConfirmados: number;
  pagadoEnCortes: number;
  cortesPorConfirmar: number;
  porPagarEnCortesPorConfirmar: number;
  multasDeChoferesSinDescontar: number;
  resultadoDeLaEmpresa: number;
};

export type Conciliacion = {
  desde: string;
  hasta: string;
  generadoAt: string;
  estado: "ok" | "discrepancia";
  discrepancias: number;
  resumen: ResumenDeDinero;
  verificaciones: ResultadoDeVerificacion[];
};

/**
 * Verificaciones cuyo caso se arregla volviendo a generar el registro de
 * liquidacion del servicio. Las demas (abonos, cortes de choferes, multas)
 * necesitan una decision de una persona y no tienen boton.
 */
export const VERIFICACIONES_RESINCRONIZABLES = new Set([
  "servicio-sin-registro",
  "registro-base",
  "registro-extras",
  "registro-transporte-cliente",
  "registro-efectivo-debido",
  "obligacion-efectivo-faltante",
  "obligacion-efectivo-importe",
]);

export type FilaDelResumen = {
  etiqueta: string;
  valor: number;
  /** `cantidad` se muestra como numero entero y no como dinero. */
  tipo?: "dinero" | "cantidad";
  ayuda?: string;
  tono?: "normal" | "aviso";
};

export type GrupoDelResumen = {
  id: string;
  titulo: string;
  filas: FilaDelResumen[];
};

/** El resumen ordenado como se lee: de lo cobrado a lo que queda. */
export function gruposDelResumen(resumen: ResumenDeDinero): GrupoDelResumen[] {
  return [
    {
      id: "cobrado",
      titulo: "Lo cobrado",
      filas: [
        { etiqueta: "Servicios terminados", valor: resumen.servicios, tipo: "cantidad" },
        { etiqueta: "Total cobrado a clientes", valor: resumen.cobradoTotal },
        { etiqueta: "En efectivo", valor: resumen.cobradoEnEfectivo },
        { etiqueta: "Con tarjeta", valor: resumen.cobradoConTarjeta },
        { etiqueta: "Por transferencia", valor: resumen.cobradoPorTransferencia },
      ],
    },
    {
      id: "composicion",
      titulo: "De que se compone",
      filas: [
        { etiqueta: "Base de los servicios", valor: resumen.base },
        { etiqueta: "Extras", valor: resumen.extras },
        { etiqueta: "De ellos, con tarjeta", valor: resumen.extrasConTarjeta },
        {
          etiqueta: "Transporte cobrado a clientes",
          valor: resumen.transporteCobradoAlCliente,
        },
      ],
    },
    {
      id: "reparto",
      titulo: "Reparto",
      filas: [
        { etiqueta: "Parte de la empresa", valor: resumen.parteDeLaEmpresa },
        {
          etiqueta: "Comision de extras con tarjeta",
          valor: resumen.comisionExtrasTarjeta,
          ayuda: "El 15 % de cada extra con tarjeta desde 1.000.",
        },
        { etiqueta: "Multas a empleadas", valor: resumen.multasDelPeriodo },
      ],
    },
    {
      id: "transporte",
      titulo: "Gasto de transporte",
      filas: [
        { etiqueta: "Viajes de choferes", valor: resumen.viajesDeChoferes, tipo: "cantidad" },
        { etiqueta: "Pago a choferes", valor: resumen.pagoAChoferes },
        { etiqueta: "Ya liquidado en un corte", valor: resumen.pagoAChoferesLiquidado },
        {
          etiqueta: "Pendiente de corte",
          valor: resumen.pagoAChoferesPendiente,
          ayuda: "Viajes terminados que todavia no entran en el corte de un chofer.",
        },
        { etiqueta: "Uber confirmado", valor: resumen.costoDeUber },
      ],
    },
    {
      id: "efectivo",
      titulo: "Efectivo por cobrar a empleadas",
      filas: [
        { etiqueta: "Por cobrar en total", valor: resumen.efectivoPorCobrar },
        {
          etiqueta: "Listo para cobrar",
          valor: resumen.efectivoPorCobrarListo,
          ayuda: "El servicio ya cerro su transporte de regreso.",
        },
        {
          etiqueta: "Provisional",
          valor: resumen.efectivoPorCobrarProvisional,
          ayuda: "Todavia falta cerrar el transporte: el importe puede cambiar.",
        },
        { etiqueta: "Obligaciones abiertas", valor: resumen.obligacionesAbiertas, tipo: "cantidad" },
        { etiqueta: "Abonos de la semana", valor: resumen.abonosDeEfectivoDelPeriodo },
      ],
    },
    {
      id: "cortes",
      titulo: "Cortes y deudas",
      filas: [
        { etiqueta: "Cortes semanales confirmados", valor: resumen.cortesConfirmados, tipo: "cantidad" },
        { etiqueta: "Pagado en cortes", valor: resumen.pagadoEnCortes },
        {
          etiqueta: "Cortes por confirmar",
          valor: resumen.cortesPorConfirmar,
          tipo: "cantidad",
          ayuda: "Empleadas con servicios esta semana y el corte sin confirmar.",
        },
        {
          etiqueta: "Por pagar en esos cortes",
          valor: resumen.porPagarEnCortesPorConfirmar,
          ayuda: "Lo que se les debe, antes de compensar el efectivo que entregan.",
        },
        { etiqueta: "Deudas abiertas del personal", valor: resumen.deudasAbiertas },
        {
          etiqueta: "Multas a choferes sin descontar",
          valor: resumen.multasDeChoferesSinDescontar,
          ayuda:
            "Se registran como sancion, pero ningun corte de chofer las resta de su pago.",
          tono: resumen.multasDeChoferesSinDescontar > 0 ? "aviso" : "normal",
        },
      ],
    },
  ];
}

/** Texto corto del estado general de la conciliacion. */
export function textoDeEstado(c: Pick<Conciliacion, "estado" | "discrepancias">) {
  if (c.estado === "ok") return "Todo cuadra";
  return c.discrepancias === 1
    ? "1 discrepancia"
    : `${c.discrepancias} discrepancias`;
}
