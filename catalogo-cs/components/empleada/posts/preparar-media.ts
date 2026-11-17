/**
 * Preparacion en el navegador de lo que sube la modelo: comprimir la foto, leer
 * la duracion y el tamaño del video y sacarle una portada.
 *
 * Vive aparte de `lib/employee-posts.ts` porque necesita DOM (`<video>`,
 * `<canvas>`, `createImageBitmap`) y aquel se prueba en `node`. Las decisiones
 * (si cabe, que segundo se captura, a que tamaño) siguen saliendo de alli.
 */

import { comprimirFoto } from "@/lib/comprimir-imagen";
import {
  dimensionValida,
  duracionEnMs,
  momentoDeLaPortada,
  tamanoDeLaPortada,
} from "@/lib/employee-posts";
import { tipoDeMediaLocal } from "@/lib/posts";

/** Lo que se mandara al backend en el multipart. */
export interface MediaPreparada {
  archivo: File;
  portada: File | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Cuanto se espera a un evento del video antes de darlo por perdido. */
const ESPERA_DEL_VIDEO_MS = 15_000;

function esperarEvento(video: HTMLVideoElement, evento: "loadedmetadata" | "seeked" | "loadeddata") {
  return new Promise<void>((resolver, rechazar) => {
    const limpiar = () => {
      clearTimeout(reloj);
      video.removeEventListener(evento, listo);
      video.removeEventListener("error", fallo);
    };
    const listo = () => {
      limpiar();
      resolver();
    };
    const fallo = () => {
      limpiar();
      rechazar(new Error("El navegador no pudo abrir el video"));
    };
    const reloj = setTimeout(() => {
      limpiar();
      rechazar(new Error("El video tardó demasiado en abrirse"));
    }, ESPERA_DEL_VIDEO_MS);
    video.addEventListener(evento, listo, { once: true });
    video.addEventListener("error", fallo, { once: true });
  });
}

/** Ancho y alto de una imagen, o `null` si el navegador no la sabe leer. */
async function dimensionesDeImagen(archivo: Blob): Promise<{ w: number; h: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const mapa = await createImageBitmap(archivo);
      const medidas = { w: mapa.width, h: mapa.height };
      mapa.close();
      return medidas;
    } catch {
      // Se intenta con <img>, que admite mas formatos en algunos Safari.
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Foto: se comprime con el preset de fotos y se miden sus pixeles. */
export async function prepararImagen(original: File): Promise<MediaPreparada> {
  const archivo = await comprimirFoto(original);
  const medidas = await dimensionesDeImagen(archivo);
  return {
    archivo,
    portada: null,
    width: dimensionValida(medidas?.w),
    height: dimensionValida(medidas?.h),
    durationMs: null,
  };
}

/**
 * Video: duracion y tamaño del metadato, y una portada capturada en un lienzo.
 *
 * El video se abre en un `<video>` que nunca entra al DOM, silenciado y con
 * `playsInline` para que iOS no intente ponerlo a pantalla completa. Si la
 * duracion ya supera el tope no se genera la portada: no se va a subir.
 *
 * Lanza si el navegador no puede abrir el video o sacar el fotograma; quien
 * llama lo explica en la cola de subida.
 */
export async function prepararVideo(
  original: File,
  { duracionMaximaMs }: { duracionMaximaMs: number },
): Promise<MediaPreparada> {
  const url = URL.createObjectURL(original);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await esperarEvento(video, "loadedmetadata");
    const durationMs = duracionEnMs(video.duration);
    const width = dimensionValida(video.videoWidth);
    const height = dimensionValida(video.videoHeight);
    if (durationMs == null || durationMs > duracionMaximaMs) {
      return { archivo: original, portada: null, width, height, durationMs };
    }

    // Sin datos del primer fotograma, `seeked` puede llegar con el lienzo en
    // negro en algunos Safari.
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await esperarEvento(video, "loadeddata");
    }
    const momento = momentoDeLaPortada(video.duration);
    if (momento > 0) {
      video.currentTime = momento;
      await esperarEvento(video, "seeked");
    }

    const tamano = tamanoDeLaPortada(video.videoWidth, video.videoHeight);
    if (!tamano) throw new Error("El video no tiene imagen");
    const lienzo = document.createElement("canvas");
    lienzo.width = tamano.ancho;
    lienzo.height = tamano.alto;
    const contexto = lienzo.getContext("2d");
    if (!contexto) throw new Error("El navegador no permite dibujar la portada");
    contexto.drawImage(video, 0, 0, tamano.ancho, tamano.alto);

    const blob = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("No se pudo generar la portada");
    const portada = await comprimirFoto(
      new File([blob], "portada.jpg", { type: "image/jpeg" }),
    );
    return { archivo: original, portada, width, height, durationMs };
  } finally {
    // Soltar el archivo: un video de 20 MB retenido por una URL de objeto se
    // queda en memoria hasta cerrar la pestaña.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Prepara cualquier archivo elegido segun su tipo declarado. */
export function prepararMedia(
  archivo: File,
  opciones: { duracionMaximaMs: number },
): Promise<MediaPreparada> {
  return tipoDeMediaLocal(archivo.type) === "video"
    ? prepararVideo(archivo, opciones)
    : prepararImagen(archivo);
}

/** El multipart de una media, con los nombres de campo del backend. */
export function formularioDeMedia(media: MediaPreparada): FormData {
  const datos = new FormData();
  datos.append("file", media.archivo, media.archivo.name);
  if (media.portada) datos.append("poster", media.portada, media.portada.name);
  if (media.width) datos.append("width", String(media.width));
  if (media.height) datos.append("height", String(media.height));
  if (media.durationMs) datos.append("durationMs", String(media.durationMs));
  return datos;
}
