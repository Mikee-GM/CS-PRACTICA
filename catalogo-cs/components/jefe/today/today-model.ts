import type { Service, ServiceOperationState } from "@/lib/types";

const BOSS_AUTHORIZATION_STATES = new Set<ServiceOperationState>([
  "preparacion",
  "preparado",
  "asignado",
]);

export type ServiceStatePresentation = {
  label: string;
  summary: string;
  tone: "gold" | "blue" | "green" | "zinc" | "red";
};

const OPERATION_PRESENTATION: Record<
  ServiceOperationState,
  ServiceStatePresentation
> = {
  preparacion: {
    label: "Preparando solicitud",
    summary: "Revisa los datos antes de continuar.",
    tone: "gold",
  },
  preparado: {
    label: "Solicitud preparada",
    summary: "La solicitud esta lista para asignarse.",
    tone: "gold",
  },
  asignado: {
    label: "Servicio asignado",
    summary: "La solicitud ya tiene una empleada asignada.",
    tone: "gold",
  },
  esperando_aceptacion_empleada: {
    label: "Esperando respuesta",
    summary: "La empleada debe aceptar o rechazar el servicio.",
    tone: "gold",
  },
  aceptado: {
    label: "Aceptado",
    summary: "Prepara el transporte de ida.",
    tone: "blue",
  },
  esperando_transporte_ida: {
    label: "Esperando transporte",
    summary: "El transporte de ida necesita atencion.",
    tone: "blue",
  },
  transporte_ida_asignado: {
    label: "Transporte asignado",
    summary: "Espera a que la empleada inicie el trayecto.",
    tone: "blue",
  },
  empleada_en_camino: {
    label: "En camino",
    summary: "Da seguimiento al traslado de ida.",
    tone: "blue",
  },
  empleada_llego: {
    label: "Empleada en destino",
    summary: "La empleada puede iniciar desde su portal.",
    tone: "green",
  },
  en_curso: {
    label: "Servicio en curso",
    summary: "Supervisa el contexto y atiende incidencias.",
    tone: "green",
  },
  preparando_regreso: {
    label: "Preparando regreso",
    summary: "Selecciona el transporte de regreso.",
    tone: "blue",
  },
  transporte_regreso_asignado: {
    label: "Regreso asignado",
    summary: "Espera a que comience el traslado de regreso.",
    tone: "blue",
  },
  empleada_de_regreso: {
    label: "De regreso",
    summary: "Da seguimiento hasta que llegue a casa.",
    tone: "blue",
  },
  finalizado: {
    label: "Finalizado",
    summary: "No hay acciones operacionales pendientes.",
    tone: "zinc",
  },
  rechazado: {
    label: "Rechazado",
    summary: "La solicitud fue rechazada.",
    tone: "red",
  },
  cancelado: {
    label: "Cancelado",
    summary: "El servicio fue cancelado.",
    tone: "red",
  },
  expirado: {
    label: "Expirado",
    summary: "La solicitud expiro sin completarse.",
    tone: "red",
  },
};

export function legacyOperationState(service: Service): ServiceOperationState {
  if (service.estado === "agendado") return "asignado";
  if (service.estado === "en_curso") return "en_curso";
  if (service.estado === "finalizado")
    return service.horaLlegadaCasa ? "finalizado" : "preparando_regreso";
  if (service.estado === "cancelado") return "cancelado";
  return "preparacion";
}

/** Estado único que deben consumir las acciones del panel, incluso para
 * servicios antiguos cuyo estado persistido todavía es `pendiente`. */
export function operationStateForService(service: Service): ServiceOperationState {
  return service.operationalState ?? legacyOperationState(service);
}

/** El jefe solo autoriza servicios que aún no fueron enviados a la empleada. */
export function canBossAuthorizeService(service: Service): boolean {
  return BOSS_AUTHORIZATION_STATES.has(operationStateForService(service));
}

/** Transporte de ida o regreso que ya puede asignarse desde el panel. */
export function canAssignTransport(service: Service): boolean {
  const state = operationStateForService(service);
  return state === "esperando_transporte_ida" || state === "preparando_regreso";
}

export function presentServiceState(
  service: Service,
): ServiceStatePresentation {
  return OPERATION_PRESENTATION[operationStateForService(service)];
}
