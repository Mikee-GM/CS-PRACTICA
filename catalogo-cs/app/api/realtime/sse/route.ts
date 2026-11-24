import { getApiBaseUrl } from "@/lib/api-server";
import { getBackendCookieHeader, getCsrfToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Canales que este proxy sabe abrir.
 *
 * Estaba fijado al de jefes, asi que los portales de modelo y chofer no tenian
 * por donde enterarse de nada: se quedaban con los datos del primer render y
 * en una aplicacion instalada eso se ve como una pantalla congelada, porque no
 * hay ni un gesto de recargar.
 */
const CANALES: Record<string, string> = {
  jefes: "/realtime/sse/jefes",
  empleada: "/realtime/sse/empleada",
  chofer: "/realtime/sse/chofer",
  // Chat web del cliente: el backend solo deja entrar a cuentas `cliente`.
  cliente: "/realtime/sse/cliente",
};

export async function GET(request: Request) {
  const canal = new URL(request.url).searchParams.get("canal") ?? "jefes";
  const ruta = CANALES[canal];
  if (!ruta) {
    return new Response("Canal desconocido", { status: 400 });
  }

  const cookie = await getBackendCookieHeader();
  if (!cookie) {
    return new Response("No autorizado", { status: 401 });
  }

  const csrfToken = await getCsrfToken();
  const apiBaseUrl = getApiBaseUrl();
  const backendUrl = `${apiBaseUrl}${ruta}`;

  try {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      Cookie: cookie,
    };

    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }

    // `request.signal` se aborta cuando el navegador se desconecta (cerrar la
    // pestana, recargar, perder la senal). Sin pasarla, la conexion hacia el
    // backend se quedaba abierta para siempre: cada desconexion dejaba un flujo
    // huerfano, con su suscripcion y su temporizador de latido, y crecian sin
    // limite.
    const response = await fetch(backendUrl, {
      headers,
      cache: "no-store",
      signal: request.signal,
    });

    if (!response.ok) {
      return new Response(`Error del backend: ${response.status}`, {
        status: response.status,
      });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    // El navegador se fue antes de que el backend contestara: no es un fallo.
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 204 });
    }
    console.error("Error en proxy SSE:", error);
    return new Response("Error interno del servidor proxy SSE", { status: 500 });
  }
}
