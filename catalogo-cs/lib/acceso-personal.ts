import { destinoSeguroDelCliente } from "@/lib/destino-cliente";
import { PATRON_CONTRASENA } from "@/lib/perfil-cliente";
import { inicioParaRol } from "@/lib/roles";

/*
 * Acceso del personal con correo y contraseña (Fase 5, F-acceso).
 *
 * Aqui vive lo que deciden a la vez el middleware, el login y las pantallas de
 * cuenta: a donde va cada sesion, cuando hay que cambiar la contraseña antes
 * de nada y como se le explica a la persona un fallo. Es codigo puro para que
 * se pruebe sin navegador ni servidor, y para que esas capas no diverjan: si
 * el middleware y el login decidieran por separado, uno mandaria al usuario
 * justo a donde el otro lo devuelve, y eso es un bucle de redirecciones.
 */

/** El login unico de todos los roles. */
export const RUTA_LOGIN = "/ingresar";

/** Pantalla bloqueante del cambio de contraseña obligatorio. */
export const RUTA_CAMBIO_FORZADO = "/cambiar-contrasena";

/** Los roles que pueden llevar la marca de cambio obligatorio. */
const ROLES_DEL_PERSONAL = ["admin", "jefe", "empleada", "chofer"] as const;

/** Los roles que tienen una pantalla de inicio. Cualquier otro no entra. */
const ROLES_CONOCIDOS = [...ROLES_DEL_PERSONAL, "cliente"] as const;

export function esRolConocido(rol: string | null | undefined): boolean {
  return Boolean(rol && (ROLES_CONOCIDOS as readonly string[]).includes(rol));
}

export function esPersonal(rol: string | null | undefined): boolean {
  return Boolean(rol && (ROLES_DEL_PERSONAL as readonly string[]).includes(rol));
}

/**
 * Sesion tal como la ve el middleware tras preguntar a `/auth/me`.
 *
 * `incomunicado` no dice nada sobre la sesion: el backend no contesto. Por eso
 * nunca es motivo para mandar a ningun sitio.
 */
export type SesionDeAcceso =
  | { estado: "ok"; rol: string; debeCambiarPassword: boolean }
  | { estado: "sin-sesion" }
  | { estado: "incomunicado" };

/**
 * ¿Esta sesion tiene que cambiar la contraseña antes de seguir?
 *
 * Solo el personal: el cliente crea su propia contraseña al registrarse y el
 * backend nunca le pone la marca. Si algun dia llegara marcada, se ignora en
 * vez de encerrarlo en una pantalla que su rol no puede usar (el endpoint del
 * personal le responderia 403).
 */
export function debeCambiarAntesDeSeguir(
  rol: string | null | undefined,
  debeCambiarPassword: boolean | null | undefined,
): boolean {
  return debeCambiarPassword === true && esPersonal(rol);
}

/**
 * Rutas que el cambio forzado no intercepta.
 *
 * `/api/*` es lo que usa la propia pantalla bloqueante --el canal de avisos,
 * el proxy al backend-- y redirigirlo devolveria HTML a un `fetch` que espera
 * JSON. Los recursos estaticos (con extension) tampoco: el manifiesto, los
 * iconos y el service worker los pide el navegador sin navegar.
 */
function rutaExenta(ruta: string): boolean {
  return (
    ruta.startsWith("/api/") ||
    ruta === "/api" ||
    ruta.startsWith("/_next/") ||
    /\.[A-Za-z0-9]+$/.test(ruta)
  );
}

/**
 * Redireccion que impone el cambio de contraseña, o `null` si no hay ninguna.
 *
 * - Con la marca puesta, cualquier pantalla lleva a la del cambio.
 * - En la pantalla del cambio sin sesion, al login; sin la marca, al inicio
 *   del rol: no hay nada que cambiar a la fuerza y quedarse ahi seria un
 *   callejon sin salida.
 * - Con el backend incomunicado no se decide nada.
 *
 * No puede haber bucle: las dos ramas que redirigen dependen de la misma marca
 * con signos opuestos, y el inicio de un rol nunca es la pantalla del cambio.
 */
export function redireccionPorCambioForzado(
  ruta: string,
  sesion: SesionDeAcceso,
): string | null {
  if (rutaExenta(ruta)) return null;
  const enLaPantalla = ruta === RUTA_CAMBIO_FORZADO;

  if (sesion.estado === "incomunicado") return null;
  if (sesion.estado === "sin-sesion") return enLaPantalla ? RUTA_LOGIN : null;

  const obligado = debeCambiarAntesDeSeguir(sesion.rol, sesion.debeCambiarPassword);
  if (obligado) return enLaPantalla ? null : RUTA_CAMBIO_FORZADO;
  if (!enLaPantalla) return null;
  return esRolConocido(sesion.rol) ? inicioParaRol(sesion.rol) : RUTA_LOGIN;
}

/**
 * A donde va alguien que acaba de entrar, o que llega al login con la sesion
 * ya abierta. `null` significa "quedate en el login".
 *
 * `siguiente` solo vale para el cliente y solo hacia sus pantallas
 * (`destinoSeguroDelCliente`); el personal va siempre a su inicio. Un rol
 * desconocido no tiene a donde ir: mandarlo a `inicioParaRol`, que para el
 * devuelve el login, haria que el login lo mandara al login.
 */
export function destinoTrasEntrar({
  rol,
  debeCambiarPassword,
  siguiente,
}: {
  rol: string | null | undefined;
  debeCambiarPassword?: boolean | null;
  siguiente?: string | null;
}): string | null {
  if (!esRolConocido(rol)) return null;
  if (debeCambiarAntesDeSeguir(rol, debeCambiarPassword)) {
    return RUTA_CAMBIO_FORZADO;
  }
  if (rol === "cliente") {
    return destinoSeguroDelCliente(siguiente) ?? inicioParaRol(rol);
  }
  return inicioParaRol(rol);
}

/* ------------------------------------------------------------------------ */
/* Contraseña                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Las mismas reglas que valida el backend: de 8 a 72 caracteres (bcrypt solo
 * lee los primeros 72 bytes), con al menos una letra y un numero. El patron se
 * comparte con el formulario del cliente para que no se separen.
 */
export { PATRON_CONTRASENA };
export const LARGO_MINIMO_CONTRASENA = 8;
export const LARGO_MAXIMO_CONTRASENA = 72;

export const AYUDA_CONTRASENA =
  "De 8 a 72 caracteres, con al menos una letra y un número.";

export const MENSAJE_SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

export const MENSAJE_CONTRASENA_REPETIDA =
  "La nueva contraseña debe ser distinta de la actual. Elige otra.";

export const MENSAJE_CONTRASENA_DEBIL =
  "La nueva contraseña debe tener de 8 a 72 caracteres, con al menos una letra y un número.";

export const MENSAJE_CONTRASENA_CAMBIADA =
  "Tu contraseña se actualizó. Por seguridad cerramos tu sesión en los demás dispositivos; en este sigues dentro.";

/**
 * Comprobacion local antes de mandar nada. Devuelve el error que dice como
 * corregirlo, o `null` si se puede enviar.
 *
 * El formulario ya valida con `pattern`, pero una Server Action se puede
 * invocar sin pasar por el, y la comparacion con la actual no la expresa
 * ningun atributo HTML.
 */
export function validarContrasenaNueva(
  actual: string,
  nueva: string,
): string | null {
  if (!actual || !nueva) return "Escribe tu contraseña actual y la nueva.";
  if (actual === nueva) return MENSAJE_CONTRASENA_REPETIDA;
  if (!new RegExp(`^(?:${PATRON_CONTRASENA})$`).test(nueva)) {
    return MENSAJE_CONTRASENA_DEBIL;
  }
  return null;
}

/** Quita acentos y mayusculas para comparar textos del backend. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Fallos que se explican igual en cualquier escritura de la cuenta. */
function errorComun(status: number | null): string | null {
  if (status === null) return MENSAJE_SIN_CONEXION;
  if (status === 429) {
    return "Hiciste demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
  }
  if (status === 403) {
    return "Tu cuenta no permite este cambio. Si crees que es un error, avisa a administración.";
  }
  if (status >= 500) {
    return "El servidor no pudo guardar el cambio. Vuelve a intentarlo en unos minutos.";
  }
  return null;
}

/**
 * Fallo del cambio de contraseña propio, traducido a lo que la persona puede
 * hacer. `status` es `null` cuando ni siquiera hubo respuesta.
 *
 * El backend responde 400 por tres motivos distintos --la actual no coincide,
 * la nueva es igual a la actual, la nueva es debil--; solo el texto los
 * distingue.
 */
export function errorAlCambiarContrasenaPropia(
  status: number | null,
  mensaje = "",
): string {
  const comun = errorComun(status);
  if (comun) return comun;
  const texto = normalizar(mensaje);
  if (texto.includes("actual no es correcta")) {
    return "La contraseña actual no es correcta. Escríbela tal como la usas para iniciar sesión.";
  }
  if (
    texto.includes("igual") ||
    texto.includes("distinta") ||
    texto.includes("diferente")
  ) {
    return MENSAJE_CONTRASENA_REPETIDA;
  }
  return MENSAJE_CONTRASENA_DEBIL;
}

/**
 * Fallo al restablecer la contraseña de otra persona.
 *
 * El backend responde 400 si es la propia cuenta (esa se cambia pidiendo la
 * actual, en Ajustes) y 409 si la cuenta esta desactivada: una temporal no le
 * devolveria el acceso, porque el login la rechaza igual.
 */
export function errorAlRestablecer(status: number | null): string {
  if (status === 400) {
    return "Tu propia contraseña se cambia desde Ajustes, con la contraseña actual.";
  }
  if (status === 409) {
    return "La cuenta está desactivada. Reactívala antes de restablecer la contraseña.";
  }
  if (status === 403) {
    return "No puedes restablecer la contraseña de esta persona: no forma parte de tu equipo.";
  }
  if (status === 404) {
    return "Esta persona ya no tiene una cuenta de acceso. Actualiza la página.";
  }
  return (
    errorComun(status) ??
    "No se pudo restablecer la contraseña. Vuelve a intentarlo."
  );
}

/** Fallo al guardar el perfil propio. */
export function errorAlGuardarPerfil(status: number | null): string {
  return (
    errorComun(status) ??
    "Revisa los datos: el nombre y el apellido no pueden quedar vacíos."
  );
}

/**
 * Texto que acompaña a la contraseña temporal recien emitida.
 *
 * La temporal solo se ve una vez: el backend no guarda nada legible. El aviso
 * lo dice antes que nada, y dice tambien que pasa despues, para que quien la
 * entrega pueda explicarselo a la persona.
 */
export function avisoDeContrasenaTemporal(nombre: string | null | undefined): {
  titulo: string;
  advertencia: string;
  instrucciones: string;
} {
  const quien = nombre?.trim() || "esta persona";
  return {
    titulo: "Contraseña temporal",
    advertencia:
      "Esta contraseña solo se muestra ahora. Cuando cierres esta ventana no se podrá volver a ver; si se pierde, habrá que restablecerla otra vez.",
    instrucciones: `Entrégasela a ${quien} por un medio seguro. Al iniciar sesión con ella, deberá crear una contraseña nueva antes de usar la aplicación. Todas sus sesiones abiertas se cerraron.`,
  };
}
