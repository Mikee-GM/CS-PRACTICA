"use server";

import { revalidatePath } from "next/cache";

import { getApiBaseUrl } from "@/lib/api-server";
import { getBackendCookieHeader, getCsrfToken } from "@/lib/auth";
import type { DriverPortalData, ReporteSobreMi } from "@/lib/types";

/** La URL del portal; la sesion viaja en cookie, nunca en la URL. */
function portalUrl(path: string) {
  return new URL(`${getApiBaseUrl()}${path}`).toString();
}

async function portalHeaders() {
  const cookie = await getBackendCookieHeader();
  const csrf = await getCsrfToken();
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  return headers;
}

export async function getDriverPortalData(): Promise<{ success: boolean; data?: DriverPortalData; error?: string }> {
  try {
    const cookie = await getBackendCookieHeader();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cookie) {
      headers["Cookie"] = cookie;
    }

    const url = new URL(`${getApiBaseUrl()}/driver-portal/me`);

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || "Error al cargar la información del portal",
      };
    }

    const data = (await response.json()) as DriverPortalData;
    return { success: true, data };
  } catch (error: any) {
    console.error("Error al obtener datos del portal de chofer:", error);
    return {
      success: false,
      error: error.message || "Error de conexión con el servidor",
    };
  }
}

/**
 * Marca que el chofer ya llego al punto de recogida.
 *
 * Mismo camino que el boton del chat: los dos llaman a `DriverTripsService`,
 * asi que no pueden divergir. El `x-csrf-token` acompana a la cookie porque el
 * backend no se fia solo de `SameSite` para las mutaciones del portal; cuando
 * se entra por el enlace del bot no hay cookie y tampoco hace falta.
 */
export async function marcarLlegadaDelViaje(
  tripId: string,
): Promise<{ success: boolean; error?: string }> {
  return avanzarViaje(tripId, "arrived");
}

/**
 * Marca que la empleada ya subio al coche.
 *
 * Cancela su margen de espera en el backend, asi que no es un boton inocente.
 */
export async function marcarRecogidaDelViaje(
  tripId: string,
): Promise<{ success: boolean; error?: string }> {
  return avanzarViaje(tripId, "picked-up");
}

/**
 * Toma una oferta de viaje.
 *
 * La misma oferta va a varios choferes, asi que puede perderse la carrera. Eso
 * llega como `aceptado: false`, no como error: es una respuesta valida y la
 * pantalla debe decirlo con esas palabras.
 */
export async function aceptarOfertaDeViaje(
  tripId: string,
): Promise<{ success: boolean; error?: string; aceptado?: boolean }> {
  const resultado = await avanzarViaje(tripId, "accept");
  return resultado;
}

/** Deja pasar una oferta, que se reofrece al siguiente chofer. */
export async function rechazarOfertaDeViaje(
  tripId: string,
): Promise<{ success: boolean; error?: string; rechazado?: boolean }> {
  return avanzarViaje(tripId, "reject");
}

/** Cierra el viaje. Es la que dispara el recibo final del servicio. */
export async function finalizarElViaje(
  tripId: string,
): Promise<{ success: boolean; error?: string }> {
  return avanzarViaje(tripId, "finished");
}

async function avanzarViaje(
  tripId: string,
  paso: "arrived" | "picked-up" | "finished" | "accept" | "reject",
): Promise<{
  success: boolean;
  error?: string;
  aceptado?: boolean;
  rechazado?: boolean;
}> {
  try {
    const cookie = await getBackendCookieHeader();
    const csrf = await getCsrfToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cookie) headers["Cookie"] = cookie;
    if (csrf) headers["x-csrf-token"] = csrf;

    const url = new URL(
      `${getApiBaseUrl()}/driver-portal/trips/${tripId}/${paso}`,
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      cache: "no-store",
      headers,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || "No se pudo marcar el avance del viaje",
      };
    }
    /*
     * `accept` responde si se gano la carrera y `reject` si la oferta seguia
     * siendo suya; los demas pasos no dicen nada. Los dos casos negativos son
     * respuestas normales, no fallos.
     */
    const cuerpo = (await response.json().catch(() => ({}))) as {
      aceptado?: boolean;
      rechazado?: boolean;
    };
    return {
      success: true,
      aceptado: cuerpo.aceptado,
      rechazado: cuerpo.rechazado,
    };
  } catch (error: any) {
    console.error("Error al marcar el avance del viaje:", error);
    return {
      success: false,
      error: error.message || "Error de conexión con el servidor",
    };
  }
}

/** Igual que en el portal de la modelo, con las cabeceras propias de este. */
export async function registrarMiUbicacion(
  lat: number,
  lng: number,
): Promise<{ success: boolean }> {
  try {
    const cookie = await getBackendCookieHeader();
    const csrf = await getCsrfToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cookie) headers["Cookie"] = cookie;
    if (csrf) headers["x-csrf-token"] = csrf;

    const url = new URL(`${getApiBaseUrl()}/driver-portal/location`);

    const response = await fetch(url.toString(), {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ lat, lng }),
    });
    return { success: response.ok };
  } catch (error) {
    // Un envio perdido no se avisa: el siguiente lo corrige.
    console.error("Error al registrar la ubicacion:", error);
    return { success: false };
  }
}

/** Una calificacion baja que todavia se puede apelar. */
export type CalificacionApelable = {
  id: string;
  direction: string;
  stars: number;
  comment: string | null;
  createdAt: string;
};

/**
 * Las calificaciones bajas que esta persona todavia puede apelar.
 *
 * El backend resuelve de quien son a partir de la sesion, nunca de un
 * parametro: no hay forma de pedir las de otro.
 */
export async function getCalificacionesApelables(): Promise<CalificacionApelable[]> {
  try {
    const response = await fetch(
      portalUrl("/driver-portal/ratings/appealable"),
      {
        method: "GET",
        cache: "no-store",
        headers: await portalHeaders(),
      },
    );
    if (!response.ok) return [];
    return (await response.json()) as CalificacionApelable[];
  } catch (error) {
    console.error("Error al leer las calificaciones apelables:", error);
    return [];
  }
}

/**
 * Apela una calificacion baja.
 *
 * Es la unica defensa ante algo que alimenta el score de confianza y puede
 * acabar en sancion. Solo existia detras de un boton del chat.
 */
export async function apelarCalificacion(
  ratingId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      portalUrl(`/driver-portal/ratings/${ratingId}/appeal`),
      {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(await portalHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err.message || "No se pudo apelar" };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error al apelar la calificacion:", error);
    return {
      success: false,
      error: error.message || "Error de conexion con el servidor",
    };
  }
}

/**
 * Levanta un reporte de conducta sobre la modelo de un viaje suyo.
 *
 * Es el mecanismo con el que se acaba bloqueando a un cliente problematico. Si
 * la unica via es el chat, un incidente se pierde justo cuando mas importa
 * registrarlo.
 */
export async function reportarConducta(
  input: {
    direction: string;
    interactionId: string;
    category: string;
    description: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(portalUrl("/driver-portal/reports"), {
      method: "POST",
      cache: "no-store",
      headers: {
        ...(await portalHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || "No se pudo enviar el reporte",
      };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error al reportar:", error);
    return {
      success: false,
      error: error.message || "Error de conexion con el servidor",
    };
  }
}

/**
 * Reporta a administracion a la empleada de un viaje suyo ya finalizado.
 *
 * Es distinto de `reportarConducta`: aquel lo revisa un jefe y alimenta el
 * bloqueo de personas; este llega a `employee_reports`, donde lo atiende
 * administracion. Solo admite sesion propia --el backend exige cookie y CSRF--,
 * asi que no hay otra via.
 */
export async function reportarEmpleadaDelViaje(input: {
  viajeId: string;
  categoria: string;
  descripcion: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(portalUrl("/driver-portal/employee-reports"), {
      method: "POST",
      cache: "no-store",
      headers: {
        ...(await portalHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const mensaje = Array.isArray(err.message)
        ? err.message.join(". ")
        : err.message;
      return {
        success: false,
        error: mensaje || "No se pudo enviar el reporte",
      };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error al reportar a la empleada:", error);
    return {
      success: false,
      error: error.message || "Error de conexion con el servidor",
    };
  }
}

/** Un viaje ya terminado cuya empleada sigue sin calificar. */
export type EmpleadaPorCalificar = {
  viajeId: string;
  tipo: "ida" | "regreso";
  fecha: string | null;
  empleadaNombre: string | null;
};

/**
 * Las empleadas de sus viajes recientes que aun no ha calificado.
 *
 * Calificar existia como endpoint y como botones del chat, pero el portal no
 * tenia de donde sacar que viaje calificar, asi que la opcion no aparecia por
 * ningun lado: quien cerraba el viaje desde el portal --o no veia el mensaje del
 * bot a tiempo-- se quedaba sin poder calificar nunca.
 */
export async function getEmpleadasPorCalificar(): Promise<EmpleadaPorCalificar[]> {
  try {
    const response = await fetch(
      portalUrl("/driver-portal/ratings/pending-employees"),
      { method: "GET", cache: "no-store", headers: await portalHeaders() },
    );
    if (!response.ok) return [];
    return (await response.json()) as EmpleadaPorCalificar[];
  } catch (error) {
    console.error("Error al leer las empleadas por calificar:", error);
    return [];
  }
}

/** Deja la valoracion del chofer sobre la empleada de uno de sus viajes. */
export async function calificarEmpleada(
  input: { viajeId: string; stars: number; comment?: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(portalUrl("/driver-portal/ratings"), {
      method: "POST",
      cache: "no-store",
      headers: {
        ...(await portalHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        direction: "driver_to_employee",
        interactionId: input.viajeId,
        stars: input.stars,
        ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || "No se pudo enviar la calificacion",
      };
    }
    revalidatePath("/chofer/portal");
    return { success: true };
  } catch (error: any) {
    console.error("Error al calificar a la empleada:", error);
    return {
      success: false,
      error: error.message || "Error de conexion con el servidor",
    };
  }
}

/**
 * Los reportes que hay sobre el, con su version si ya la escribio.
 *
 * Antes no tenia forma de saber que existian: se enteraba, si acaso, cuando ya
 * habia una sancion encima y la decision se habia tomado con un solo relato
 * delante.
 */
export async function getReportesSobreMi(): Promise<ReporteSobreMi[]> {
  try {
    const response = await fetch(
      portalUrl("/driver-portal/reports/mine"),
      { method: "GET", cache: "no-store", headers: await portalHeaders() },
    );
    if (!response.ok) return [];
    return (await response.json()) as ReporteSobreMi[];
  } catch (error) {
    console.error("Error al leer los reportes propios:", error);
    return [];
  }
}

/** Manda su version de un reporte abierto. Se puede corregir mientras siga abierto. */
export async function responderReporte(
  reportId: string,
  statement: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      portalUrl(`/driver-portal/reports/${reportId}/statement`),
      {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(await portalHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ statement }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const mensaje = Array.isArray(err.message)
        ? err.message.join(". ")
        : err.message;
      return {
        success: false,
        error: mensaje || "No se pudo enviar tu versión",
      };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error al responder el reporte:", error);
    return {
      success: false,
      error: error.message || "Error de conexion con el servidor",
    };
  }
}
