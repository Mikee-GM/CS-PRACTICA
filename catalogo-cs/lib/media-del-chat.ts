/**
 * Reglas puras de las fotos y notas de voz del chat, compartidas por el cliente
 * y por quien atiende. Aparte de los componentes para poder probarlas sin DOM.
 */

/** Lo mismo que acepta el backend: una foto hasta 10 MB y un audio hasta 8 MB. */
export const MAX_FOTO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** Una nota de voz no pasa de cinco minutos (el backend rechaza mas). */
export const MAX_AUDIO_MS = 5 * 60 * 1000;
/** Mas corto que esto es un toque accidental, no un mensaje. */
export const MIN_AUDIO_MS = 700;

export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"];

export type MediaParaEnviar = {
  kind: "foto" | "audio";
  archivo: File;
  /** Solo audio, en milisegundos. */
  durationMs?: number;
};

/** `1:05` para 65 000 ms. Nunca negativo ni NaN: un audio sin metadatos no rompe la burbuja. */
export function formatearDuracion(ms: number | undefined | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.round(ms / 1000);
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}

const FORMATOS_DE_GRABACION: Array<{ mime: string; extension: string }> = [
  { mime: "audio/webm;codecs=opus", extension: "webm" },
  { mime: "audio/webm", extension: "webm" },
  { mime: "audio/mp4", extension: "m4a" },
  { mime: "audio/ogg;codecs=opus", extension: "ogg" },
];

/**
 * El primer formato de grabacion que este navegador sabe producir: Chrome y
 * Firefox graban WebM u Ogg; Safari (iPhone) solo MP4. `null` si no hay
 * `MediaRecorder` o ninguno sirve.
 */
export function formatoDeGrabacion(
  soportado: (mime: string) => boolean,
): { mime: string; extension: string } | null {
  return FORMATOS_DE_GRABACION.find((f) => soportado(f.mime)) ?? null;
}

/** Por que no se puede grabar aqui, dicho de forma que se sepa que hacer. */
export function motivoSinMicrofono(entorno: {
  contextoSeguro: boolean;
  tieneGetUserMedia: boolean;
  tieneMediaRecorder: boolean;
}): string | null {
  if (!entorno.contextoSeguro) {
    return "El navegador solo deja usar el micrófono en una conexión segura (https). Abre el sitio con su dirección https.";
  }
  if (!entorno.tieneGetUserMedia || !entorno.tieneMediaRecorder) {
    return "Este navegador no puede grabar audio. Prueba con una versión reciente de Chrome, Safari o Firefox.";
  }
  return null;
}

/** Por que fallo `getUserMedia`, con el paso a seguir. */
export function mensajeDeMicrofono(nombreDelError: string): string {
  switch (nombreDelError) {
    case "NotAllowedError":
    case "SecurityError":
      return "No diste permiso para usar el micrófono. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No encontramos un micrófono en este dispositivo.";
    case "NotReadableError":
      return "El micrófono está en uso por otra aplicación. Ciérrala y vuelve a intentarlo.";
    default:
      return "No pudimos activar el micrófono. Vuelve a intentarlo.";
  }
}

/** Valida lo que se va a enviar antes de subirlo; devuelve el motivo o `null`. */
export function errorDeMedia(media: {
  kind: "foto" | "audio";
  type: string;
  size: number;
}): string | null {
  if (media.size === 0) return "El archivo está vacío.";
  if (media.kind === "foto") {
    if (!TIPOS_DE_FOTO.includes(media.type)) {
      return "La foto debe ser JPEG, PNG o WEBP.";
    }
    if (media.size > MAX_FOTO_BYTES) return "La foto pesa más de 10 MB.";
    return null;
  }
  if (media.size > MAX_AUDIO_BYTES) return "El audio pesa más de 8 MB.";
  return null;
}
