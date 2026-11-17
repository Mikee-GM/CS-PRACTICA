import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/locale";

/*
 * Perfil del cliente: tipos y textos de `/cuenta`.
 *
 * Vive aparte de los componentes para que el formato (la cifra de la
 * calificacion, la fecha en hora de Mexico, el error que dice como corregir)
 * se pruebe sin navegador.
 */

/** Respuesta de `GET /client-accounts/me/perfil`. */
export type PerfilCliente = {
  nombre: string | null;
  email: string;
  correoVerificado: boolean;
  /** ISO 8601. */
  miembroDesde: string;
  /** Servicios finalizados. */
  servicios: number;
  /** `promedio` llega `null` mientras no haya calificaciones suficientes. */
  calificacion: { promedio: number | null; cantidad: number };
  nivel: { codigo: string; nombre: string };
  estado: "activa" | "restringida";
};

/**
 * Calificaciones a partir de las cuales el backend publica el promedio. Solo
 * se usa para explicarlo: quien decide si hay promedio es el backend, que lo
 * manda `null` por debajo de este numero.
 */
export const MINIMO_DE_CALIFICACIONES = 3;

/**
 * Una letra y un numero, de 8 a 72 caracteres: lo mismo que valida el backend
 * (bcrypt solo lee los primeros 72 bytes). `pattern` exige coincidencia total.
 */
export const PATRON_CONTRASENA = "(?=.*[A-Za-z])(?=.*\\d).{8,72}";

export const LARGO_MAXIMO_NOMBRE = 255;

export type TextoDeCalificacion =
  | {
      suficiente: true;
      /** "4,5". */
      cifra: string;
      /** "12 calificaciones". */
      detalle: string;
      /** Frase completa para lectores de pantalla: "4,5 de 5, 12 calificaciones". */
      accesible: string;
    }
  | { suficiente: false; titulo: string; detalle: string };

function plural(cantidad: number, singular: string, plural: string): string {
  const cifra = new Intl.NumberFormat(APP_LOCALE).format(cantidad);
  return `${cifra} ${cantidad === 1 ? singular : plural}`;
}

/**
 * La cifra con una decimal y coma, como se escribe en español: `4,5`.
 *
 * `es-MX` separa los decimales con punto, por eso se pide el redondeo a `Intl`
 * (que redondea en decimal y no arrastra el error de `toFixed`) y se cambia el
 * separador despues.
 */
export function cifraDeCalificacion(promedio: number): string {
  const acotado = Math.min(5, Math.max(0, promedio));
  return new Intl.NumberFormat(APP_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  })
    .format(acotado)
    .replace(".", ",");
}

export function textoDeCalificacion(
  calificacion: PerfilCliente["calificacion"],
): TextoDeCalificacion {
  const { promedio, cantidad } = calificacion;
  if (promedio === null || !Number.isFinite(promedio)) {
    return {
      suficiente: false,
      titulo: "Aún sin calificación suficiente",
      detalle: `Se mostrará a partir de ${MINIMO_DE_CALIFICACIONES} calificaciones de las modelos.`,
    };
  }
  const cifra = cifraDeCalificacion(promedio);
  const detalle = plural(cantidad, "calificación", "calificaciones");
  return { suficiente: true, cifra, detalle, accesible: `${cifra} de 5, ${detalle}` };
}

export const TEXTO_DEL_NIVEL = "Tu nivel se actualizará con tu actividad.";

export function textoDeServicios(servicios: number): string {
  if (!Number.isFinite(servicios) || servicios <= 0) {
    return "Aún no tienes servicios completados";
  }
  return plural(servicios, "servicio completado", "servicios completados");
}

/**
 * Cualquier valor que no sea `activa` se lee como restringida: ante un estado
 * desconocido es preferible decirle al cliente que algo esta limitado a
 * asegurarle que todo esta en orden.
 */
export function textoDeEstado(estado: string): {
  restringida: boolean;
  titulo: string;
  detalle: string;
} {
  if (estado === "activa") {
    return {
      restringida: false,
      titulo: "Cuenta activa",
      detalle: "Puedes usar tu cuenta con normalidad.",
    };
  }
  return {
    restringida: true,
    titulo: "Cuenta con restricciones",
    detalle:
      "Algunas funciones de tu cuenta están limitadas por ahora. Si crees que se trata de un error, comunícate con el equipo de Colombia Sexys para revisarlo.",
  };
}

/** "17 de noviembre de 2026" en hora de Mexico, o `null` si la fecha no vale. */
export function textoMiembroDesde(iso: string): string | null {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fecha);
}

/** Nombre limpio, o el error que dice como corregirlo. */
export function validarNombre(
  nombre: string,
): { valido: true; nombre: string } | { valido: false; error: string } {
  const limpio = nombre.trim();
  if (!limpio) return { valido: false, error: "Escribe tu nombre." };
  if (limpio.length > LARGO_MAXIMO_NOMBRE) {
    return {
      valido: false,
      error: `Escribe un nombre de hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`,
    };
  }
  return { valido: true, nombre: limpio };
}

export const MENSAJE_SIN_CONEXION =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

export const MENSAJE_PERFIL_NO_DISPONIBLE =
  "No se pudo cargar tu perfil. Revisa tu conexión y vuelve a intentarlo.";

export const MENSAJE_CONTRASENA_CAMBIADA =
  "Tu contraseña se actualizó. Por seguridad cerramos tu sesión en los demás dispositivos; en este sigues dentro.";

export const MENSAJE_NOMBRE_GUARDADO = "Tu nombre se guardó.";

export const MENSAJE_CONTRASENA_REPETIDA =
  "La nueva contraseña debe ser distinta de la actual. Elige otra.";

/**
 * Fallo de una escritura del perfil, traducido a lo que el cliente puede
 * hacer. `status` es `null` cuando ni siquiera hubo respuesta.
 */
function errorComun(status: number | null): string | null {
  if (status === null) return MENSAJE_SIN_CONEXION;
  if (status === 429) {
    return "Hiciste demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
  }
  if (status === 403) {
    return "Tu cuenta no permite este cambio por ahora. Si crees que es un error, comunícate con el equipo.";
  }
  if (status >= 500) {
    return "El servidor no pudo guardar el cambio. Vuelve a intentarlo en unos minutos.";
  }
  return null;
}

export function errorAlCambiarNombre(status: number | null): string {
  return (
    errorComun(status) ??
    `Revisa tu nombre: debe tener entre 1 y ${LARGO_MAXIMO_NOMBRE} caracteres.`
  );
}

/**
 * El backend responde 400 tanto si la contraseña actual no coincide como si la
 * nueva es igual a la actual; solo el texto los distingue.
 */
export function errorAlCambiarContrasena(
  status: number | null,
  mensaje = "",
): string {
  const comun = errorComun(status);
  if (comun) return comun;
  const texto = mensaje
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (texto.includes("actual no es correcta")) {
    return "La contraseña actual no es correcta. Escríbela tal como la usas para iniciar sesión.";
  }
  if (texto.includes("igual") || texto.includes("distinta") || texto.includes("diferente")) {
    return MENSAJE_CONTRASENA_REPETIDA;
  }
  return "La nueva contraseña debe tener de 8 a 72 caracteres, con al menos una letra y un número.";
}
