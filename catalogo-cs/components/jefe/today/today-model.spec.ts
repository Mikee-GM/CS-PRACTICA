import type { Service } from "@/lib/types";
import {
  canAssignTransport,
  canBossAuthorizeService,
  presentServiceState,
} from "./today-model";

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "service-1",
    empleadaId: "employee-1",
    clienteId: "client-1",
    jefeId: "boss-1",
    metodoPago: "efectivo",
    duracionPactadaHoras: "2",
    duracionFinalHoras: null,
    ubicacionClienteLat: "19.4",
    ubicacionClienteLng: "-99.1",
    precioBaseHoraPactado: "1000",
    totalBase: "2000",
    totalExtras: "0",
    totalFinal: "2000",
    horaInicioServicio: null,
    horaFinServicio: null,
    horaLlegadaCasa: null,
    prorrogasUsadas: 0,
    estado: "agendado",
    notas: null,
    iaActiva: true,
    calificacion: null,
    comentariosCalificacion: null,
    servicioPrevioId: null,
    horaInicioEstimada: null,
    createdAt: "2026-10-05T10:00:00.000Z",
    calculationStatus: "ready",
    pendingReason: null,
    customerTotal: 2000,
    uberDeduction: 0,
    updatedAt: "2026-10-05T10:00:00.000Z",
    cliente: {
      id: "client-1",
      nombre: "Carlos",
    },
    empleada: {
      id: "employee-1",
      usuarioId: "user-1",
      nombreReal: "Andrea",
      nombreArtistico: "Andrea",
      slugCatalogo: "andrea",
      fotoPerfilUrl: null,
      descripcion: null,
      precioBaseHora: "1000",
      disponible: true,
      catalogoActivo: true,
      totalServiciosValorados: 0,
      promedioCalificacion: null,
      ubicacionLat: null,
      ubicacionLng: null,
    },
    ...overrides,
  };
}

describe("modelo de estado operacional", () => {
  it("respeta el estado operacional entregado por el backend", () => {
    expect(
      presentServiceState(
        service({ operationalState: "esperando_aceptacion_empleada" }),
      ).label,
    ).toBe("Esperando respuesta");
  });

  it("no muestra autorización para un servicio que espera a la empleada", () => {
    const waiting = service({
      estado: "pendiente",
      operationalState: "esperando_aceptacion_empleada",
    });

    expect(canBossAuthorizeService(waiting)).toBe(false);
    expect(canAssignTransport(waiting)).toBe(false);
  });

  it("expone asignar transporte cuando la empleada ya aceptó", () => {
    const waiting = service({
      estado: "pendiente",
      operationalState: "esperando_transporte_ida",
    });

    expect(canBossAuthorizeService(waiting)).toBe(false);
    expect(canAssignTransport(waiting)).toBe(true);
  });

  it("mantiene autorización para estados previos al envío", () => {
    expect(
      canBossAuthorizeService(
        service({ operationalState: "preparado", estado: "pendiente" }),
      ),
    ).toBe(true);
  });
});
