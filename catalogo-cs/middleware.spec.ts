import { NextRequest } from "next/server";
import { BACKEND_API_PREFIX } from "@/lib/api-constants";

/**
 * El middleware es la costura entre el navegador y NestJS, y es donde se
 * concentraron tres fallos seguidos que ni la compilacion ni los tipos veian:
 *
 *  - el prefijo de version se armaba como `/api/1` en vez de `/api/v1`, y el
 *    backend respondia 404;
 *  - `/api/geocode`, que es una ruta propia de Next, no estaba entre las
 *    exclusiones, asi que la busqueda de direcciones se reescribia al backend
 *    y fallaba en silencio;
 *  - la cabecera `Cookie` se reenviaba cruda, con la capa de codificacion que
 *    Next le anade encima de la firma de Express, y el backend respondia 401
 *    con una sesion recien abierta.
 *
 * Los tres son de enrutado puro --entra una peticion, sale una respuesta-- asi
 * que se pueden fijar aqui sin navegador ni servidor.
 */

const BACKEND = "http://backend-de-prueba:4000";

/*
 * El modulo se carga tras fijar la variable de entorno porque `backendUrl()` la
 * lee en cada llamada, pero el import se evalua una sola vez por fichero.
 */
process.env.BACKEND_API_URL = BACKEND;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { middleware } = require("./middleware") as {
  middleware: (peticion: NextRequest) => Promise<Response> | Response;
};

/** Una peticion del navegador, con las cookies que se quieran. */
function peticion(ruta: string, cookies: Record<string, string> = {}) {
  const cabeceras = new Headers();
  const armadas = Object.entries(cookies)
    .map(([nombre, valor]) => `${nombre}=${valor}`)
    .join("; ");
  if (armadas) cabeceras.set("cookie", armadas);
  return new NextRequest(new URL(ruta, "https://colombia-sexys.test"), {
    headers: cabeceras,
  });
}

/** A donde reescribio el middleware, o null si no reescribio. */
function destinoReescrito(respuesta: Response): string | null {
  return respuesta.headers.get("x-middleware-rewrite");
}

describe("middleware: reescritura de /api hacia el backend", () => {
  it("traduce la ruta con el prefijo de version completo", async () => {
    const respuesta = await middleware(peticion("/api/services/pendientes"));

    expect(destinoReescrito(respuesta)).toBe(
      `${BACKEND}${BACKEND_API_PREFIX}/services/pendientes`,
    );
  });

  it("conserva la cadena de consulta", async () => {
    const respuesta = await middleware(peticion("/api/services?estado=en_curso"));

    expect(destinoReescrito(respuesta)).toBe(
      `${BACKEND}${BACKEND_API_PREFIX}/services?estado=en_curso`,
    );
  });

  /*
   * El prefijo se afirma contra su valor literal ademas de contra la constante:
   * si alguien reintroduce el `/api/1` sin la `v`, cambiar la constante haria
   * pasar la prueba anterior sin arreglar nada.
   */
  it("el prefijo es /api/v1, no /api/1", () => {
    expect(BACKEND_API_PREFIX).toBe("/api/v1");
  });

  it.each([
    "/api/assistant/mensaje",
    "/api/auth/login",
    "/api/geocode?q=polanco",
    "/api/health",
    "/api/realtime",
    "/api/version",
  ])("no reescribe %s, que es una ruta propia de Next", async (ruta) => {
    const respuesta = await middleware(peticion(ruta));

    expect(destinoReescrito(respuesta)).toBeNull();
  });

  /*
   * Las cookies de sesion van firmadas por Express como `s%3A<valor>.<firma>`, y
   * Next les anade su propia capa al guardarlas. Reenviar la cabecera cruda le
   * entrega al backend el texto con la capa de mas: `signedCookies` llega vacio
   * y el guard responde 401 aunque la sesion acabe de empezar.
   */
  it("rearma la cookie en vez de reenviar la cruda del navegador", async () => {
    const firmada = "s%3Avalor.firma";
    const respuesta = await middleware(
      peticion("/api/services", { access_token: firmada }),
    );

    // La cookie que el middleware pone para el backend, ya rearmada.
    const enviada = respuesta.headers.get("x-middleware-request-cookie");

    // Decodificada una vez: `s:valor.firma`, que es lo que `cookie-parser`
    // sabe verificar. Con la cabecera cruda llegaria `s%3Avalor.firma`.
    expect(enviada).toBe("access_token=s:valor.firma");
  });
});

describe("middleware: area del cliente", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  /** Ruta a la que redirigio la respuesta, sea el `Location` absoluto o relativo. */
  function destino(respuesta: Response): string | null {
    const ubicacion = respuesta.headers.get("location");
    return ubicacion
      ? new URL(ubicacion, "https://colombia-sexys.test").pathname
      : null;
  }

  /** El backend responde a `/auth/me` con el rol dado. */
  function backendConRol(rol: string) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rol }),
    }) as unknown as typeof fetch;
  }

  it("manda al login de cliente, no al del panel, si no hay sesion", async () => {
    const respuesta = await middleware(peticion("/cuenta"));

    expect(destino(respuesta)).toBe("/ingresar");
  });

  it("deja pasar a un cliente con sesion", async () => {
    backendConRol("cliente");

    const respuesta = await middleware(
      peticion("/cuenta", { access_token: "s:valor.firma" }),
    );

    expect(destino(respuesta)).toBeNull();
  });

  it("devuelve al personal a su propio inicio", async () => {
    backendConRol("jefe");

    const respuesta = await middleware(
      peticion("/cuenta", { access_token: "s:valor.firma" }),
    );

    expect(destino(respuesta)).toBe("/jefe");
  });

  it.each(["/admin", "/admin/dashboard", "/jefe"])(
    "un cliente que abre %s aterriza en su portada, las publicaciones",
    async (ruta) => {
      backendConRol("cliente");

      const respuesta = await middleware(
        peticion(ruta, { access_token: "s:valor.firma" }),
      );

      expect(destino(respuesta)).toBe("/feed");
    },
  );

  describe.each(["/chats", "/chats/0f4e2c1a-1b2c-4d5e-8f90-123456789abc", "/feed"])(
    "chats del cliente (%s)",
    (ruta) => {
      it("sin sesion manda al login de cliente y recuerda a donde volver", async () => {
        const respuesta = await middleware(peticion(ruta));

        expect(destino(respuesta)).toBe("/ingresar");
        const ubicacion = new URL(
          respuesta.headers.get("location") ?? "",
          "https://colombia-sexys.test",
        );
        expect(ubicacion.searchParams.get("siguiente")).toBe(ruta);
      });

      it("deja pasar a un cliente con sesion", async () => {
        backendConRol("cliente");

        const respuesta = await middleware(
          peticion(ruta, { access_token: "s:valor.firma" }),
        );

        expect(destino(respuesta)).toBeNull();
      });

      it("devuelve al personal a su propio inicio", async () => {
        backendConRol("empleada");

        const respuesta = await middleware(
          peticion(ruta, { access_token: "s:valor.firma" }),
        );

        expect(destino(respuesta)).toBe("/empleada/portal");
      });

      it("con la sesion rechazada por el backend vuelve al login", async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({}),
        }) as unknown as typeof fetch;

        const respuesta = await middleware(
          peticion(ruta, { access_token: "s:valor.firma" }),
        );

        expect(destino(respuesta)).toBe("/ingresar");
      });
    },
  );

  it("el matcher cubre la bandeja y cada conversacion", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { config } = require("./middleware") as {
      config: { matcher: string[] };
    };

    expect(config.matcher).toEqual(
      expect.arrayContaining(["/chats", "/chats/:path*", "/feed", "/modelos/:path*"]),
    );
  });

  describe("perfil publico de una modelo", () => {
    it("sin sesion se sirve, sin mandar al login", async () => {
      const respuesta = await middleware(peticion("/modelos/valentina"));

      expect(destino(respuesta)).toBeNull();
    });

    it("con el acceso caducado renueva y guarda las cookies nuevas", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          "set-cookie": "access_token=nuevo; Path=/; HttpOnly",
        }),
      }) as unknown as typeof fetch;

      const respuesta = await middleware(
        peticion("/modelos/valentina", { refresh_token: "s:refresco.firma" }),
      );

      expect(destino(respuesta)).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: `${BACKEND_API_PREFIX}/auth/refresh` }),
        expect.objectContaining({ method: "POST" }),
      );
      expect(respuesta.headers.get("set-cookie")).toMatch(/access_token=nuevo/);
    });

    it("no le pregunta el rol al backend: un empleado tambien puede verlo", async () => {
      global.fetch = jest.fn() as unknown as typeof fetch;

      const respuesta = await middleware(
        peticion("/modelos/valentina", { access_token: "s:valor.firma" }),
      );

      expect(destino(respuesta)).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe("middleware: publicaciones de la modelo", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it("el matcher cubre /empleada/posts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { config } = require("./middleware") as {
      config: { matcher: string[] };
    };

    expect(config.matcher).toEqual(expect.arrayContaining(["/empleada/posts"]));
  });

  /*
   * Mismo trato que los ajustes del portal: la pagina decide la sesion por su
   * cuenta, y el middleware solo renueva el acceso caducado para que una
   * subida no acabe en el login a mitad de camino.
   */
  it("con el acceso caducado renueva y guarda las cookies nuevas", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "set-cookie": "access_token=nuevo; Path=/; HttpOnly",
      }),
    }) as unknown as typeof fetch;

    const respuesta = await middleware(
      peticion("/empleada/posts", { refresh_token: "s:refresco.firma" }),
    );

    expect(respuesta.headers.get("location")).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: `${BACKEND_API_PREFIX}/auth/refresh` }),
      expect.objectContaining({ method: "POST" }),
    );
    expect(respuesta.headers.get("set-cookie")).toMatch(/access_token=nuevo/);
  });

  it("con sesion vigente no consulta al backend ni redirige", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const respuesta = await middleware(
      peticion("/empleada/posts", { access_token: "s:valor.firma" }),
    );

    expect(respuesta.headers.get("location")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("middleware: login unico y cambio de contraseña obligatorio", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  function destino(respuesta: Response): string | null {
    const ubicacion = respuesta.headers.get("location");
    return ubicacion
      ? new URL(ubicacion, "https://colombia-sexys.test").pathname
      : null;
  }

  /** El backend responde a `/auth/me` con este cuerpo. */
  function backendResponde(cuerpo: Record<string, unknown>) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(cuerpo),
    }) as unknown as typeof fetch;
  }

  const conSesion = { access_token: "s:valor.firma" };

  it.each(["/admin", "/admin/dashboard", "/admin/modelos", "/jefe", "/jefe/equipo"])(
    "%s sin sesion manda al login unico, no al del panel",
    async (ruta) => {
      global.fetch = jest.fn() as unknown as typeof fetch;

      const respuesta = await middleware(peticion(ruta));

      expect(destino(respuesta)).toBe("/ingresar");
    },
  );

  it("/admin con la sesion rechazada por el backend manda al login unico", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    const respuesta = await middleware(peticion("/admin", conSesion));

    expect(destino(respuesta)).toBe("/ingresar");
  });

  it.each([
    ["admin", "/admin/dashboard"],
    ["jefe", "/jefe"],
    ["empleada", "/empleada/portal"],
    ["chofer", "/chofer/portal"],
  ])("/admin con sesion de %s lleva a su inicio", async (rol, inicio) => {
    backendResponde({ rol, debeCambiarPassword: false });

    const respuesta = await middleware(peticion("/admin", conSesion));

    expect(destino(respuesta)).toBe(inicio);
  });

  it.each([
    ["admin", "/admin"],
    ["admin", "/admin/dashboard"],
    ["jefe", "/jefe"],
    ["jefe", "/jefe/servicios"],
    ["empleada", "/chats"],
    ["chofer", "/cuenta"],
  ])(
    "%s con contraseña temporal que abre %s va a la pantalla del cambio",
    async (rol, ruta) => {
      backendResponde({ rol, debeCambiarPassword: true });

      const respuesta = await middleware(peticion(ruta, conSesion));

      expect(destino(respuesta)).toBe("/cambiar-contrasena");
    },
  );

  it("la pantalla del cambio se sirve a quien tiene la marca (sin bucle)", async () => {
    backendResponde({ rol: "empleada", debeCambiarPassword: true });

    const respuesta = await middleware(peticion("/cambiar-contrasena", conSesion));

    expect(destino(respuesta)).toBeNull();
  });

  it("la pantalla del cambio sin la marca devuelve al inicio del rol", async () => {
    backendResponde({ rol: "jefe", debeCambiarPassword: false });

    const respuesta = await middleware(peticion("/cambiar-contrasena", conSesion));

    expect(destino(respuesta)).toBe("/jefe");
  });

  it("la pantalla del cambio sin sesion manda al login sin preguntar al backend", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const respuesta = await middleware(peticion("/cambiar-contrasena"));

    expect(destino(respuesta)).toBe("/ingresar");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("la pantalla del cambio con el backend incomunicado se sirve, no echa a nadie", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const respuesta = await middleware(peticion("/cambiar-contrasena", conSesion));

    expect(destino(respuesta)).toBeNull();
  });

  it("un backend sin el campo no obliga a nadie", async () => {
    backendResponde({ rol: "admin" });

    const respuesta = await middleware(peticion("/admin/dashboard", conSesion));

    expect(destino(respuesta)).toBeNull();
  });

  it("el proxy de /api no se intercepta aunque haya marca: no pregunta al backend", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const respuesta = await middleware(peticion("/api/users/me/password", conSesion));

    expect(destinoReescrito(respuesta)).toBe(
      `${BACKEND}${BACKEND_API_PREFIX}/users/me/password`,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("el matcher cubre la pantalla del cambio", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { config } = require("./middleware") as {
      config: { matcher: string[] };
    };

    expect(config.matcher).toEqual(expect.arrayContaining(["/cambiar-contrasena"]));
  });
});
