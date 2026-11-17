import {
  avisoDeContrasenaTemporal,
  debeCambiarAntesDeSeguir,
  destinoTrasEntrar,
  errorAlCambiarContrasenaPropia,
  errorAlRestablecer,
  MENSAJE_CONTRASENA_DEBIL,
  MENSAJE_CONTRASENA_REPETIDA,
  MENSAJE_SIN_CONEXION,
  redireccionPorCambioForzado,
  RUTA_CAMBIO_FORZADO,
  RUTA_LOGIN,
  validarContrasenaNueva,
  type SesionDeAcceso,
} from "./acceso-personal";

const PERSONAL = ["admin", "jefe", "empleada", "chofer"] as const;

function ok(rol: string, debeCambiarPassword = false): SesionDeAcceso {
  return { estado: "ok", rol, debeCambiarPassword };
}

describe("debeCambiarAntesDeSeguir", () => {
  it.each(PERSONAL)("obliga al rol %s cuando trae la marca", (rol) => {
    expect(debeCambiarAntesDeSeguir(rol, true)).toBe(true);
  });

  it("no obliga sin la marca", () => {
    expect(debeCambiarAntesDeSeguir("jefe", false)).toBe(false);
    expect(debeCambiarAntesDeSeguir("jefe", undefined)).toBe(false);
  });

  it("nunca obliga al cliente: su rol no puede usar el endpoint del personal", () => {
    expect(debeCambiarAntesDeSeguir("cliente", true)).toBe(false);
  });
});

describe("redireccionPorCambioForzado", () => {
  it.each(PERSONAL)(
    "con la marca, %s solo puede ver la pantalla del cambio",
    (rol) => {
      for (const ruta of ["/admin/dashboard", "/jefe", "/empleada/portal", "/chofer/ajustes", RUTA_LOGIN, "/admin"]) {
        expect(redireccionPorCambioForzado(ruta, ok(rol, true))).toBe(
          RUTA_CAMBIO_FORZADO,
        );
      }
    },
  );

  it("con la marca, en la propia pantalla del cambio no redirige (sin bucle)", () => {
    expect(redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, ok("empleada", true))).toBeNull();
  });

  it.each(["/api/auth/me", "/api/v1/users/me/password", "/api/realtime/sse", "/manifest-admin.webmanifest", "/sw.js", "/_next/static/chunk.js"])(
    "no intercepta %s: la API y los recursos tienen que seguir respondiendo",
    (ruta) => {
      expect(redireccionPorCambioForzado(ruta, ok("chofer", true))).toBeNull();
    },
  );

  it("sin la marca, la pantalla del cambio devuelve al inicio del rol", () => {
    expect(redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, ok("jefe"))).toBe("/jefe");
    expect(redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, ok("cliente"))).toBe("/feed");
  });

  it("sin la marca, el resto de rutas no se toca", () => {
    expect(redireccionPorCambioForzado("/admin/dashboard", ok("admin"))).toBeNull();
  });

  it("un rol desconocido en la pantalla del cambio va al login, no a otra redireccion", () => {
    expect(redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, ok("desconocido"))).toBe(RUTA_LOGIN);
  });

  it("sin sesion, la pantalla del cambio manda al login y lo demas no se decide aqui", () => {
    expect(redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, { estado: "sin-sesion" })).toBe(RUTA_LOGIN);
    expect(redireccionPorCambioForzado("/admin/dashboard", { estado: "sin-sesion" })).toBeNull();
  });

  it("con el backend incomunicado no manda a ningun sitio", () => {
    expect(redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, { estado: "incomunicado" })).toBeNull();
    expect(redireccionPorCambioForzado("/jefe", { estado: "incomunicado" })).toBeNull();
  });

  it("el inicio de ningun rol es la pantalla del cambio, que es lo que evita el bucle", () => {
    for (const rol of [...PERSONAL, "cliente"]) {
      const inicio = redireccionPorCambioForzado(RUTA_CAMBIO_FORZADO, ok(rol));
      expect(inicio).not.toBe(RUTA_CAMBIO_FORZADO);
      expect(redireccionPorCambioForzado(inicio ?? "", ok(rol))).toBeNull();
    }
  });
});

describe("destinoTrasEntrar", () => {
  it.each([
    ["admin", "/admin/dashboard"],
    ["jefe", "/jefe"],
    ["empleada", "/empleada/portal"],
    ["chofer", "/chofer/portal"],
    ["cliente", "/feed"],
  ])("lleva a %s a su inicio", (rol, destino) => {
    expect(destinoTrasEntrar({ rol })).toBe(destino);
  });

  it.each(PERSONAL)("con la marca, %s va a la pantalla del cambio", (rol) => {
    expect(destinoTrasEntrar({ rol, debeCambiarPassword: true })).toBe(RUTA_CAMBIO_FORZADO);
  });

  it("respeta `siguiente` solo para el cliente y solo hacia sus pantallas", () => {
    expect(destinoTrasEntrar({ rol: "cliente", siguiente: "/chats?modelo=val" })).toBe(
      "/chats?modelo=val",
    );
    expect(destinoTrasEntrar({ rol: "cliente", siguiente: "/admin/kpis" })).toBe("/feed");
    expect(destinoTrasEntrar({ rol: "cliente", siguiente: "//otro.sitio" })).toBe("/feed");
    expect(destinoTrasEntrar({ rol: "jefe", siguiente: "/chats" })).toBe("/jefe");
  });

  it("la marca gana sobre `siguiente`", () => {
    expect(
      destinoTrasEntrar({ rol: "empleada", debeCambiarPassword: true, siguiente: "/chats" }),
    ).toBe(RUTA_CAMBIO_FORZADO);
  });

  it.each([null, undefined, "", "desconocido"])(
    "un rol %p no tiene destino: el login se queda en el login",
    (rol) => {
      expect(destinoTrasEntrar({ rol })).toBeNull();
    },
  );
});

describe("validarContrasenaNueva", () => {
  it("acepta una contraseña con letra y numero de 8 a 72 caracteres", () => {
    expect(validarContrasenaNueva("Temporal1", "nuevaClave9")).toBeNull();
    expect(validarContrasenaNueva("x", `a1${"b".repeat(70)}`)).toBeNull();
  });

  it("pide los dos campos", () => {
    expect(validarContrasenaNueva("", "nuevaClave9")).toMatch(/Escribe/);
    expect(validarContrasenaNueva("Temporal1", "")).toMatch(/Escribe/);
  });

  it("rechaza repetir la actual", () => {
    expect(validarContrasenaNueva("igual1234", "igual1234")).toBe(MENSAJE_CONTRASENA_REPETIDA);
  });

  it.each([
    ["corta1", "menos de 8"],
    ["solamenteletras", "sin numero"],
    ["1234567890", "sin letra"],
    [`a1${"b".repeat(71)}`, "mas de 72"],
  ])("rechaza %p (%s)", (nueva) => {
    expect(validarContrasenaNueva("Temporal1", nueva)).toBe(MENSAJE_CONTRASENA_DEBIL);
  });
});

describe("errorAlCambiarContrasenaPropia", () => {
  it("distingue la contraseña actual incorrecta, con o sin acentos", () => {
    expect(errorAlCambiarContrasenaPropia(400, "La contraseña actual no es correcta")).toMatch(
      /actual no es correcta/,
    );
    expect(errorAlCambiarContrasenaPropia(400, "La contrasena ACTUAL no es correcta")).toMatch(
      /actual no es correcta/,
    );
  });

  it("distingue la nueva igual a la actual", () => {
    expect(
      errorAlCambiarContrasenaPropia(400, "La nueva contraseña debe ser distinta de la actual"),
    ).toBe(MENSAJE_CONTRASENA_REPETIDA);
  });

  it("cualquier otro 400 explica los requisitos", () => {
    expect(errorAlCambiarContrasenaPropia(400, "nueva must match")).toBe(MENSAJE_CONTRASENA_DEBIL);
  });

  it.each([
    [null, MENSAJE_SIN_CONEXION],
    [429, "demasiados intentos"],
    [403, "no permite"],
    [503, "servidor"],
  ])("estado %p", (status, esperado) => {
    expect(errorAlCambiarContrasenaPropia(status as number | null)).toContain(esperado);
  });
});

describe("errorAlRestablecer", () => {
  it("un 403 explica que la persona no es de su equipo", () => {
    expect(errorAlRestablecer(403)).toMatch(/equipo/);
  });

  it("un 404 pide actualizar", () => {
    expect(errorAlRestablecer(404)).toMatch(/Actualiza/);
  });

  it("sin respuesta habla de la conexion", () => {
    expect(errorAlRestablecer(null)).toBe(MENSAJE_SIN_CONEXION);
  });

  it("la propia cuenta (400) se manda a Ajustes", () => {
    expect(errorAlRestablecer(400)).toMatch(/Ajustes/);
  });

  it("una cuenta desactivada (409) pide reactivarla", () => {
    expect(errorAlRestablecer(409)).toMatch(/Reactívala/);
  });
});

describe("avisoDeContrasenaTemporal", () => {
  it("dice que no se volvera a mostrar y que habra que cambiarla al entrar", () => {
    const aviso = avisoDeContrasenaTemporal("Valentina");
    expect(aviso.advertencia).toMatch(/solo se muestra ahora/);
    expect(aviso.advertencia).toMatch(/no se podrá volver a ver/);
    expect(aviso.instrucciones).toMatch(/Valentina/);
    expect(aviso.instrucciones).toMatch(/deberá crear una contraseña nueva/);
  });

  it("sin nombre habla de esta persona", () => {
    expect(avisoDeContrasenaTemporal("  ").instrucciones).toMatch(/esta persona/);
  });
});
