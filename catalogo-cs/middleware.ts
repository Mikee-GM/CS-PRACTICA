import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
} from "@/lib/auth-constants";
import { BACKEND_API_PREFIX } from "@/lib/api-constants";
import {
  buildCookieHeader,
  parseSetCookieHeaders,
  type ParsedCookie,
} from "@/lib/set-cookie";
import { redirectFromRequest } from "@/lib/redirect";
import { inicioParaRol, puedeEntrarEn } from "@/lib/roles";
import {
  redireccionPorCambioForzado,
  RUTA_CAMBIO_FORZADO,
  RUTA_LOGIN,
  type SesionDeAcceso,
} from "@/lib/acceso-personal";

function backendUrl() {
  return process.env.BACKEND_API_URL || "http://localhost:4000";
}

/**
 * Renueva la sesion con el refresh token, si es que hay uno.
 *
 * Va en el middleware y no en `apiFetch` porque un Server Component no puede
 * escribir cookies: cuando el render descubre que el access token caduco ya es
 * tarde para renovarlo, y lo unico que le queda es mandar al login. El
 * middleware corre antes del render y si puede escribirlas.
 *
 * Devuelve las cookies nuevas, o `null` si no hay con que renovar o el backend
 * la rechaza -- refresh caducado, sesion cerrada desde otro dispositivo.
 */
async function renovarSesion(
  request: NextRequest,
): Promise<ParsedCookie[] | null> {
  if (!request.cookies.has(REFRESH_COOKIE)) return null;

  const destino = new URL(
    `${BACKEND_API_PREFIX}/auth/refresh`,
    backendUrl(),
  );

  try {
    const response = await fetch(destino, {
      method: "POST",
      cache: "no-store",
      headers: {
        // Armada, no cruda: reenviarla tal cual llega con una capa de
        // codificacion de mas y Express no reconoce la firma del refresh.
        Cookie: buildCookieHeader(request),
        // El backend compara esta cabecera con la cookie homonima. La cookie no
        // es httpOnly justamente para poder repetirla aqui.
        "x-csrf-token": request.cookies.get(CSRF_COOKIE)?.value ?? "",
      },
    });
    if (!response.ok) return null;

    const cookies = parseSetCookieHeaders(response);
    return cookies.length > 0 ? cookies : null;
  } catch {
    // Backend caido o inalcanzable. Se trata como sesion no renovable: mejor
    // mandar al login que servir una pagina que va a reventar al pedir datos.
    return null;
  }
}

/**
 * Renueva la sesion si al navegador ya se le caduco el acceso.
 *
 * El access token dura doce horas y el navegador borra su cookie al vencer; el
 * refresco vive un año. Este es el punto donde una cosa se convierte en la
 * otra, y por eso tiene que correr en TODAS las rutas que la sesion sostiene,
 * no solo en las paginas del panel: los portales de modelo y chofer no
 * renovaban nunca --su rama devolvia antes de llegar aqui-- asi que su sesion
 * moria a la hora, y el proxy de `/api` tampoco, de modo que el canal de avisos
 * se quedaba reconectando contra un 401 para siempre. Son justo las dos
 * pantallas que tienen que seguir vivas para que lleguen las notificaciones.
 *
 * Devuelve las cookies nuevas, o `null` si no hizo falta renovar o no se pudo.
 * Cuando renueva, las deja tambien sobre la peticion, para que lo que venga
 * detras --el render, el proxy-- ya vea la sesion buena sin otro viaje.
 */
async function renovarSiHaceFalta(
  request: NextRequest,
): Promise<ParsedCookie[] | null> {
  if (request.cookies.has(ACCESS_COOKIE)) return null;

  const renovadas = await renovarSesion(request);
  if (!renovadas) return null;

  for (const { name, value } of renovadas) {
    request.cookies.set(name, value);
  }
  return renovadas;
}

/** Copia sobre la respuesta las cookies que devolvio la renovacion. */
function conCookies(
  respuesta: NextResponse,
  renovadas: ParsedCookie[] | null,
): NextResponse {
  for (const { name, value, options } of renovadas ?? []) {
    respuesta.cookies.set(name, value, options);
  }
  return respuesta;
}

/**
 * Rol de la sesion, segun el backend, y si tiene que cambiar la contraseña.
 *
 * Se pregunta a `/auth/me` en vez de leer el JWT aqui: el backend verifica la
 * firma y comprueba que la sesion siga viva, mientras que descodificar el token
 * en el middleware daria por bueno cualquier payload que alguien pusiera en la
 * cookie. Una decision de autorizacion no puede apoyarse en un dato sin
 * verificar.
 *
 * La marca del cambio obligatorio viaja en la misma respuesta, asi que
 * imponerlo no cuesta una peticion mas en las rutas que ya preguntaban el rol.
 */
async function rolDeLaSesion(cookieHeader: string): Promise<SesionDeAcceso> {
  if (!cookieHeader) return { estado: "sin-sesion" };
  const destino = new URL(`${BACKEND_API_PREFIX}/auth/me`, backendUrl());
  try {
    const response = await fetch(destino, {
      cache: "no-store",
      headers: { Cookie: cookieHeader },
    });
    if (!response.ok) return { estado: "sin-sesion" };
    const data = (await response.json()) as {
      rol?: unknown;
      debeCambiarPassword?: unknown;
    };
    return typeof data?.rol === "string"
      ? {
          estado: "ok",
          rol: data.rol,
          // Solo un `true` explicito obliga: un backend sin el campo no
          // encierra a nadie en la pantalla del cambio.
          debeCambiarPassword: data.debeCambiarPassword === true,
        }
      : { estado: "sin-sesion" };
  } catch {
    /*
     * Backend caido, reiniciandose o con la red a medias.
     *
     * Antes esto se trataba igual que no tener sesion y mandaba al login: un
     * bache de unos segundos echaba del panel a todo el mundo, y volver a
     * entrar exige la contraseña. No dice nada sobre si la sesion es valida,
     * asi que no puede ser motivo para cerrarla.
     */
    return { estado: "incomunicado" };
  }
}

/**
 * Cambia el token con el que se abre un portal por una sesion en cookie.
 *
 * Los portales de empleada y chofer se abren desde una Mini App de Telegram,
 * que trae el token en la URL. Una aplicacion instalada arranca desde su icono,
 * sin token, asi que sin esto no se podia abrir dos veces; y los avisos push
 * tampoco funcionan dentro del webview de Telegram, solo en la app instalada.
 *
 * Devuelve las cookies nuevas, o `null` si el canje falla. En ese caso no se
 * toca nada y la pagina sigue resolviendo el token por su cuenta, como hasta
 * ahora: un enlace viejo tiene que seguir abriendo el portal.
 */
async function canjearTokenDePortal(
  request: NextRequest,
  token: string,
): Promise<ParsedCookie[] | null> {
  const destino = new URL(`${BACKEND_API_PREFIX}/auth/portal-session`, backendUrl());

  try {
    const response = await fetch(destino, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        // Identifica el dispositivo en la sesion, igual que en el login.
        "user-agent": request.headers.get("user-agent") ?? "portal",
      },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) return null;

    const cookies = parseSetCookieHeaders(response);
    return cookies.length > 0 ? cookies : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  /*
   * 0. Canje del token de portal.
   *
   * Solo la primera vez: si ya hay cookie de acceso, la sesion esta abierta y
   * el token de la URL sobra. Al canjear se redirige a la misma ruta sin el
   * token, porque una URL con credencial acaba en el historial del telefono,
   * en los registros del proxy y en la cabecera Referer de cualquier recurso.
   */
  /*
   * La pantalla del servicio en curso entra aqui tambien: es a donde apuntan
   * los avisos que se mandan durante un servicio, y sin el canje un enlace con
   * token aterrizaria sin sesion.
   */
  if (
    pathname === "/empleada/portal" ||
    pathname === "/chofer/portal" ||
    pathname === "/empleada/servicio" ||
    pathname === "/chofer/servicio"
  ) {
    const tokenDePortal = request.nextUrl.searchParams.get("token");
    if (tokenDePortal && !request.cookies.has(ACCESS_COOKIE)) {
      const canjeadas = await canjearTokenDePortal(request, tokenDePortal);
      if (canjeadas) {
        const limpia = new URL(request.nextUrl);
        limpia.searchParams.delete("token");
        const respuesta = NextResponse.redirect(limpia);
        for (const { name, value, options } of canjeadas) {
          respuesta.cookies.set(name, value, options);
        }
        return respuesta;
      }
    }
    /*
     * Y si no habia token que canjear, se renueva como en cualquier otra ruta.
     *
     * Esta rama devolvia aqui mismo, asi que la sesion de los portales no se
     * renovaba nunca: a la hora, cuando el navegador borraba la cookie de
     * acceso, la modelo o el chofer se encontraban con el login del panel.
     */
    return conCookies(
      NextResponse.next({ request: { headers: request.headers } }),
      await renovarSiHaceFalta(request),
    );
  }

  // 1. Proxy /api/* requests to NestJS backend (excluding Next.js internal API routes)
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/assistant") &&
    !pathname.startsWith("/api/auth") &&
    !pathname.startsWith("/api/geocode") &&
    !pathname.startsWith("/api/health") &&
    !pathname.startsWith("/api/realtime") &&
    !pathname.startsWith("/api/version")
  ) {
    /*
     * El backend publica toda su superficie bajo `/api/v1`. Aqui se traduce
     * `/api/algo` del navegador a `/api/v1/algo` del backend.
     *
     * Se usa el prefijo ya construido y no `/api/${BACKEND_API_VERSION}`, que
     * daba `/api/1` sin la `v` y hacia que el backend respondiera 404. No se
     * noto antes porque ninguna llamada del navegador pasaba por aqui: las
     * paginas piden sus datos en el servidor con `apiFetch`, que arma el
     * prefijo bien, y las rutas propias de Next quedan excluidas arriba.
     */
    /*
     * Renovar antes de reenviar.
     *
     * Es el unico camino por el que el navegador llega al backend sin pasar por
     * un render, asi que si aqui no se renueva, una peticion hecha justo
     * despues de caducar el acceso se va con la cookie vacia y vuelve 401.
     */
    const renovadasApi = await renovarSiHaceFalta(request);

    const apiPath = pathname.replace(/^\/api/, BACKEND_API_PREFIX);
    const targetUrl = new URL(`${apiPath}${search}`, backendUrl());
    /*
     * La cookie se rearma antes de reenviarla, igual que hacen la renovacion y
     * la consulta de rol de mas abajo.
     *
     * Las cookies de sesion van firmadas por Express, que las escribe como
     * `s%3A<valor>.<firma>`, y Next les añade su propia capa de codificacion al
     * guardarlas. Reenviar la cabecera cruda del navegador le entrega al
     * backend ese texto con la capa de mas: `cookie-parser` no reconoce la
     * firma, `signedCookies` llega vacio y el guard responde 401 aunque la
     * sesion acabe de empezar. `buildCookieHeader` la reconstruye desde las
     * cookies ya decodificadas por Next, que es lo que Express espera.
     */
    const cabeceras = new Headers(request.headers);
    cabeceras.set("cookie", buildCookieHeader(request));
    return conCookies(
      NextResponse.rewrite(targetUrl, { request: { headers: cabeceras } }),
      renovadasApi,
    );
  }

  // 2. Auth checks for /admin and /jefe routes
  const isAdminRoute = pathname.startsWith("/admin");
  const isJefeRoute = pathname.startsWith("/jefe");

  if (isAdminRoute || isJefeRoute) {
    /*
     * A) `/admin` a secas ya no es un login.
     *
     * Hay un solo login para todos los roles, `/ingresar`. `/admin` sigue
     * siendo la direccion que tiene guardada el personal --y el `start_url` de
     * la aplicacion instalada del panel--, asi que no puede dar un 404: con
     * sesion lleva al inicio del rol (o al cambio de contraseña obligatorio) y
     * sin ella, al login. Se resuelve aqui y no en la pagina para no pintar el
     * marco del panel a quien no tiene sesion.
     */
    if (pathname === "/admin") {
      const renovadas = await renovarSiHaceFalta(request);
      if (!request.cookies.has(ACCESS_COOKIE)) {
        return conCookies(redirectFromRequest(request, RUTA_LOGIN), renovadas);
      }

      const sesion = await rolDeLaSesion(buildCookieHeader(request));
      // Sin rol confirmado (sesion rechazada o backend incomunicado) se manda
      // al login, que vuelve a mirar la sesion por su cuenta. Las cookies que
      // dejo la renovacion se guardan igual en vez de desperdiciarlas.
      if (sesion.estado !== "ok") {
        return conCookies(redirectFromRequest(request, RUTA_LOGIN), renovadas);
      }

      return conCookies(
        redirectFromRequest(
          request,
          redireccionPorCambioForzado(pathname, sesion) ??
            inicioParaRol(sesion.rol),
        ),
        renovadas,
      );
    }

    // B) Rutas protegidas de /admin/* y /jefe/*.
    /*
     * Sin access token, pero eso no significa que la sesion haya terminado: la
     * cookie tiene la vida corta del token y el navegador la borra sola al
     * caducar. Ese es justo el momento de renovar. Las cookies nuevas van a dos
     * sitios: a la peticion, para que el render de esta misma pagina ya vea la
     * sesion renovada, y a la respuesta, para que el navegador las guarde.
     */
    const renovadas = await renovarSiHaceFalta(request);
    if (!request.cookies.has(ACCESS_COOKIE)) {
      return redirectFromRequest(request, RUTA_LOGIN);
    }

    /*
     * C) El rol, que es lo que faltaba.
     *
     * Hasta aqui bastaba con TENER sesion: cualquier cuenta autenticada —un
     * jefe, una empleada, un chofer— podia abrir cualquier pagina de `/admin`.
     * Y el boton "Abrir en el panel" que se manda al grupo del jefe llevaba una
     * ruta de administracion, asi que el jefe acababa dentro del panel de admin
     * ya autenticado sin haber hecho nada raro.
     */
    const area = isAdminRoute ? "admin" : "jefe";
    const sesion = await rolDeLaSesion(buildCookieHeader(request));
    if (sesion.estado === "sin-sesion") {
      return redirectFromRequest(request, RUTA_LOGIN);
    }
    /*
     * El cambio de contraseña obligatorio va antes que el rol: quien entra con
     * una temporal no ve nada del panel hasta poner la suya.
     */
    const alCambio = redireccionPorCambioForzado(pathname, sesion);
    if (alCambio) return conCookies(redirectFromRequest(request, alCambio), renovadas);
    /*
     * Con el backend incomunicado se deja pasar en vez de mandar al login.
     *
     * No se puede comprobar el rol, pero tampoco se puede servir ningun dato:
     * todo lo que pinta la pagina sale del mismo backend que no contesta, asi
     * que lo que se ve es una pantalla degradada, no informacion de otro rol. A
     * cambio, un bache de unos segundos deja de costar la sesion de todos.
     */
    if (sesion.estado === "ok" && !puedeEntrarEn(area, sesion.rol)) {
      return redirectFromRequest(request, inicioParaRol(sesion.rol));
    }

    return conCookies(
      NextResponse.next({ request: { headers: request.headers } }),
      renovadas,
    );
  }

  /*
   * 3. Area del cliente.
   *
   * Sin sesion se manda al login de cliente, no al del panel. El rol se
   * comprueba contra el backend, como en /admin: una cuenta del personal que
   * llegue aqui vuelve a su propio inicio.
   *
   * El login recibe la ruta pedida en `siguiente` para volver a ella --un
   * enlace a una conversacion concreta no debe acabar en la bandeja--. Lo que
   * se le pase ahi lo valida `destinoSeguroDelCliente` al usarlo.
   */
  /*
   * El feed tambien: solo lo ve un cliente con sesion. El perfil de una modelo
   * (`/modelos/<slug>`) no entra aqui a proposito: es publico, sin sesion se ve
   * la ficha sin publicaciones, y solo pasa por el matcher para renovar.
   */
  if (
    pathname === "/cuenta" ||
    pathname === "/feed" ||
    pathname === "/chats" ||
    pathname.startsWith("/chats/")
  ) {
    const alLogin = `/ingresar?siguiente=${encodeURIComponent(`${pathname}${search}`)}`;
    const renovadas = await renovarSiHaceFalta(request);
    if (!request.cookies.has(ACCESS_COOKIE)) {
      return redirectFromRequest(request, alLogin);
    }
    const sesion = await rolDeLaSesion(buildCookieHeader(request));
    if (sesion.estado === "sin-sesion") {
      return redirectFromRequest(request, alLogin);
    }
    // Personal con una temporal que cae aqui: directo al cambio, sin pasar
    // antes por su inicio para que este lo vuelva a mandar.
    const alCambio = redireccionPorCambioForzado(pathname, sesion);
    if (alCambio) return conCookies(redirectFromRequest(request, alCambio), renovadas);
    if (sesion.estado === "ok" && sesion.rol !== "cliente") {
      return redirectFromRequest(request, inicioParaRol(sesion.rol));
    }
    return conCookies(
      NextResponse.next({ request: { headers: request.headers } }),
      renovadas,
    );
  }

  /*
   * 4. Pantalla del cambio de contraseña obligatorio.
   *
   * Sin sesion va al login; sin la marca, al inicio del rol, porque no hay
   * nada que cambiar a la fuerza. La decision es la misma funcion que usan
   * las demas ramas, asi que no se pueden contradecir y mandarse la una a la
   * otra en bucle.
   */
  if (pathname === RUTA_CAMBIO_FORZADO) {
    const renovadas = await renovarSiHaceFalta(request);
    if (!request.cookies.has(ACCESS_COOKIE)) {
      return redirectFromRequest(request, RUTA_LOGIN);
    }
    const sesion = await rolDeLaSesion(buildCookieHeader(request));
    const destino = redireccionPorCambioForzado(pathname, sesion);
    if (destino) return conCookies(redirectFromRequest(request, destino), renovadas);
    return conCookies(
      NextResponse.next({ request: { headers: request.headers } }),
      renovadas,
    );
  }

  /*
   * Todo lo demas del matcher, que renueva igual.
   *
   * Aqui caen los ajustes de cada portal y, sobre todo, `/api/realtime/sse`:
   * la rama de arriba lo excluye a proposito --lo sirve una ruta propia de
   * Next-- y es el canal por el que llegan los avisos en vivo. Se reconecta
   * solo cada vez que se cae, asi que sin renovar, en cuanto caducaba el acceso
   * esa reconexion chocaba con un 401 una y otra vez y las notificaciones se
   * apagaban en silencio hasta que alguien navegara a otra pagina.
   */
  return conCookies(
    NextResponse.next({ request: { headers: request.headers } }),
    await renovarSiHaceFalta(request),
  );
}

/*
 * Las pantallas nuevas de cada portal --el servicio en curso y los ajustes de
 * avisos-- se enumeran una a una, igual que los portales.
 *
 * No se usa `/empleada/:path*` porque el bloque de canje de token de arriba
 * distingue rutas exactas, y ampliarlo a comodin haria pasar por el canje a
 * pantallas que no lo necesitan. La autorizacion de verdad la hace el backend;
 * esto solo evita que quien no tiene sesion aterrice en una pagina rota.
 */
export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/jefe/:path*",
    "/empleada/portal",
    "/empleada/historial",
    "/empleada/servicio",
    "/empleada/ajustes",
    // Publicaciones del feed: renueva como los ajustes. Sube media por Server
    // Action, de ahi `middlewareClientMaxBodySize` en next.config.ts.
    "/empleada/posts",
    "/chofer/portal",
    "/chofer/servicio",
    "/chofer/ajustes",
    // Acceso del cliente: renuevan la sesion para que quien ya tiene cuenta no
    // vea el formulario con un acceso caducado.
    "/cuenta",
    "/chats",
    "/chats/:path*",
    "/feed",
    // Solo renueva: el perfil es publico y no exige sesion, pero con ella
    // caducada se veria como si no la hubiera y faltarian las publicaciones.
    "/modelos/:path*",
    "/ingresar",
    "/registro",
    // Cambio de contraseña obligatorio del personal (contraseña temporal).
    "/cambiar-contrasena",
  ],
};
