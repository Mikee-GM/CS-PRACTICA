import {
  cifraDeCalificacion,
  errorAlCambiarContrasena,
  errorAlCambiarNombre,
  MENSAJE_SIN_CONEXION,
  PATRON_CONTRASENA,
  textoDeCalificacion,
  textoDeEstado,
  textoDeServicios,
  textoMiembroDesde,
  validarNombre,
} from "./perfil-cliente";

describe("cifraDeCalificacion", () => {
  it.each([
    [4.5, "4,5"],
    [4, "4,0"],
    [4.25, "4,3"],
    [4.75, "4,8"],
    [4.333, "4,3"],
    [5, "5,0"],
  ])("%p se escribe %p", (promedio, esperado) => {
    expect(cifraDeCalificacion(promedio)).toBe(esperado);
  });

  it("no sale de la escala de 0 a 5", () => {
    expect(cifraDeCalificacion(7)).toBe("5,0");
    expect(cifraDeCalificacion(-1)).toBe("0,0");
  });
});

describe("textoDeCalificacion", () => {
  it("con promedio da la cifra, el detalle y la frase accesible", () => {
    expect(textoDeCalificacion({ promedio: 4.5, cantidad: 12 })).toEqual({
      suficiente: true,
      cifra: "4,5",
      detalle: "12 calificaciones",
      accesible: "4,5 de 5, 12 calificaciones",
    });
  });

  it("usa el singular con una sola calificacion", () => {
    const texto = textoDeCalificacion({ promedio: 5, cantidad: 1 });
    expect(texto.suficiente && texto.detalle).toBe("1 calificación");
  });

  it("sin promedio no inventa un cero ni una estrella vacia", () => {
    const texto = textoDeCalificacion({ promedio: null, cantidad: 2 });
    expect(texto.suficiente).toBe(false);
    expect(!texto.suficiente && texto.titulo).toBe("Aún sin calificación suficiente");
    expect(JSON.stringify(texto)).not.toMatch(/0,0|cero/);
  });

  it("trata un promedio que no es numero como insuficiente", () => {
    expect(textoDeCalificacion({ promedio: Number.NaN, cantidad: 5 }).suficiente).toBe(false);
  });
});

describe("textoDeEstado", () => {
  it("cuenta activa", () => {
    expect(textoDeEstado("activa")).toMatchObject({
      restringida: false,
      titulo: "Cuenta activa",
    });
  });

  it("cuenta restringida explica a quien acudir", () => {
    const estado = textoDeEstado("restringida");
    expect(estado.restringida).toBe(true);
    expect(estado.titulo).toBe("Cuenta con restricciones");
    expect(estado.detalle).toMatch(/equipo/);
  });

  it("un estado desconocido no se presenta como activo", () => {
    expect(textoDeEstado("otro").restringida).toBe(true);
  });
});

describe("textoMiembroDesde", () => {
  it("lee la fecha en hora de Mexico, no en UTC", () => {
    // 03:00 UTC del 1 de marzo son las 21:00 del 28 de febrero en Mexico.
    expect(textoMiembroDesde("2026-03-01T03:00:00.000Z")).toBe(
      "28 de febrero de 2026",
    );
  });

  it("devuelve null con una fecha invalida", () => {
    expect(textoMiembroDesde("no es fecha")).toBeNull();
  });
});

describe("textoDeServicios", () => {
  it.each([
    [0, "Aún no tienes servicios completados"],
    [1, "1 servicio completado"],
    [3, "3 servicios completados"],
    [1200, "1,200 servicios completados"],
  ])("%p", (servicios, esperado) => {
    expect(textoDeServicios(servicios)).toBe(esperado);
  });
});

describe("validarNombre", () => {
  it("recorta espacios", () => {
    expect(validarNombre("  Andres  ")).toEqual({ valido: true, nombre: "Andres" });
  });

  it("rechaza un nombre vacio", () => {
    expect(validarNombre("   ")).toEqual({ valido: false, error: "Escribe tu nombre." });
  });

  it("rechaza mas de 255 caracteres", () => {
    expect(validarNombre("a".repeat(256)).valido).toBe(false);
    expect(validarNombre("a".repeat(255)).valido).toBe(true);
  });
});

describe("errores del perfil", () => {
  it("sin respuesta habla de la conexion", () => {
    expect(errorAlCambiarNombre(null)).toBe(MENSAJE_SIN_CONEXION);
    expect(errorAlCambiarContrasena(null)).toBe(MENSAJE_SIN_CONEXION);
  });

  it("la contraseña actual incorrecta dice como corregirla", () => {
    expect(
      errorAlCambiarContrasena(400, "La contraseña actual no es correcta"),
    ).toMatch(/^La contraseña actual no es correcta\. Escríbela/);
  });

  it("la misma contraseña pide otra distinta", () => {
    expect(
      errorAlCambiarContrasena(400, "La nueva contraseña debe ser distinta de la actual"),
    ).toBe("La nueva contraseña debe ser distinta de la actual. Elige otra.");
    expect(
      errorAlCambiarContrasena(400, "La contraseña nueva es igual a la actual"),
    ).toBe("La nueva contraseña debe ser distinta de la actual. Elige otra.");
  });

  it("otro 400 recuerda los requisitos", () => {
    expect(errorAlCambiarContrasena(400, "nueva must be longer")).toMatch(/8 a 72/);
    expect(errorAlCambiarNombre(400)).toMatch(/entre 1 y 255/);
  });

  it("limites y fallos del servidor", () => {
    expect(errorAlCambiarNombre(429)).toMatch(/Espera unos minutos/);
    expect(errorAlCambiarContrasena(503)).toMatch(/servidor/);
  });
});

describe("PATRON_CONTRASENA", () => {
  const cumple = (valor: string) => new RegExp(`^(?:${PATRON_CONTRASENA})$`).test(valor);

  it("exige letra, numero y de 8 a 72", () => {
    expect(cumple("abcdefg1")).toBe(true);
    expect(cumple("abcdefgh")).toBe(false);
    expect(cumple("12345678")).toBe(false);
    expect(cumple("abc1")).toBe(false);
    expect(cumple(`a1${"x".repeat(71)}`)).toBe(false);
  });
});
