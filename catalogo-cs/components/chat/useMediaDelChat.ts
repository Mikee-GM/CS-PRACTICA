"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { comprimirFoto } from "@/lib/comprimir-imagen";
import {
  errorDeMedia,
  formatoDeGrabacion,
  MAX_AUDIO_MS,
  mensajeDeMicrofono,
  MIN_AUDIO_MS,
  motivoSinMicrofono,
  type MediaParaEnviar,
} from "@/lib/media-del-chat";

export type EstadoDeMedia =
  | { fase: "inactivo" }
  | { fase: "pidiendo-permiso" }
  | { fase: "grabando"; inicio: number }
  | { fase: "foto"; archivo: File; vista: string };

/**
 * Fotos, camara y notas de voz del chat, para quien escribe (cliente o equipo).
 *
 * La camara no usa `getUserMedia`: es un `<input capture>`, que en el telefono
 * abre la aplicacion de camara y funciona tambien por http. El microfono si
 * necesita `getUserMedia` y por tanto un contexto seguro (https o localhost);
 * si no lo hay, el motivo se dice en vez de fallar callado.
 *
 * La foto elegida no sale hasta confirmarla (el texto del cuadro de mensaje la
 * acompaña como pie); la nota de voz sale al terminar de grabar.
 */
export function useMediaDelChat({
  onEnviar,
}: {
  onEnviar: (media: MediaParaEnviar, pie?: string) => void;
}) {
  const [estado, setEstado] = useState<EstadoDeMedia>({ fase: "inactivo" });
  const [error, setError] = useState("");
  const [segundos, setSegundos] = useState(0);

  const grabador = useRef<MediaRecorder | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const trozos = useRef<Blob[]>([]);
  const descartar = useRef(false);
  const inicio = useRef(0);
  const temporizador = useRef<ReturnType<typeof setInterval> | null>(null);
  const formato = useRef<{ mime: string; extension: string } | null>(null);
  const onEnviarRef = useRef(onEnviar);
  useEffect(() => {
    onEnviarRef.current = onEnviar;
  }, [onEnviar]);

  const soltarMicrofono = useCallback(() => {
    if (temporizador.current) clearInterval(temporizador.current);
    temporizador.current = null;
    flujo.current?.getTracks().forEach((pista) => pista.stop());
    flujo.current = null;
    grabador.current = null;
  }, []);

  // La vista previa de la foto ocupa memoria hasta que se libera su URL.
  useEffect(() => {
    return () => {
      if (estado.fase === "foto") URL.revokeObjectURL(estado.vista);
    };
  }, [estado]);

  // Al salir de la pantalla no puede quedar el microfono abierto.
  useEffect(() => {
    return () => {
      descartar.current = true;
      if (grabador.current?.state === "recording") grabador.current.stop();
      soltarMicrofono();
    };
  }, [soltarMicrofono]);

  const elegirFoto = useCallback((archivo: File | null | undefined) => {
    setError("");
    if (!archivo) return;
    // Solo el formato aqui: el peso se comprueba despues de comprimir, porque una
    // foto de camara pasa de 10 MB antes de comprimirse y despues no.
    const problema = errorDeMedia({ kind: "foto", type: archivo.type, size: 1 });
    if (problema) {
      setError(problema);
      return;
    }
    setEstado({ fase: "foto", archivo, vista: URL.createObjectURL(archivo) });
  }, []);

  const enviarFoto = useCallback(async (pie?: string): Promise<boolean> => {
    if (estado.fase !== "foto") return false;
    setError("");
    try {
      const comprimida = await comprimirFoto(estado.archivo);
      const problema = errorDeMedia({
        kind: "foto",
        type: comprimida.type,
        size: comprimida.size,
      });
      if (problema) {
        setError(problema);
        return false;
      }
      onEnviarRef.current({ kind: "foto", archivo: comprimida }, pie?.trim() || undefined);
      setEstado({ fase: "inactivo" });
      return true;
    } catch {
      setError("No pudimos preparar la foto. Elige otra e inténtalo de nuevo.");
      return false;
    }
  }, [estado]);

  const iniciarGrabacion = useCallback(async () => {
    setError("");
    const motivo = motivoSinMicrofono({
      contextoSeguro: typeof window !== "undefined" && window.isSecureContext,
      tieneGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      tieneMediaRecorder: typeof MediaRecorder !== "undefined",
    });
    if (motivo) {
      setError(motivo);
      return;
    }
    const elegido = formatoDeGrabacion((mime) => MediaRecorder.isTypeSupported(mime));
    if (!elegido) {
      setError("Este navegador no puede grabar audio. Prueba con una versión reciente.");
      return;
    }
    setEstado({ fase: "pidiendo-permiso" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      flujo.current = stream;
      formato.current = elegido;
      trozos.current = [];
      descartar.current = false;
      const recorder = new MediaRecorder(stream, { mimeType: elegido.mime });
      grabador.current = recorder;
      recorder.ondataavailable = (evento) => {
        if (evento.data.size > 0) trozos.current.push(evento.data);
      };
      recorder.onstop = () => {
        const duracion = Date.now() - inicio.current;
        const bloques = trozos.current;
        const descartado = descartar.current;
        soltarMicrofono();
        setEstado({ fase: "inactivo" });
        setSegundos(0);
        if (descartado) return;
        if (duracion < MIN_AUDIO_MS) {
          setError("La nota de voz es muy corta. Mantén la grabación un poco más.");
          return;
        }
        const tipo = elegido.mime.split(";")[0];
        const archivo = new File(bloques, `nota-de-voz.${elegido.extension}`, { type: tipo });
        onEnviarRef.current({
          kind: "audio",
          archivo,
          durationMs: Math.min(duracion, MAX_AUDIO_MS),
        });
      };
      inicio.current = Date.now();
      recorder.start();
      setSegundos(0);
      setEstado({ fase: "grabando", inicio: inicio.current });
      temporizador.current = setInterval(() => {
        const transcurrido = Date.now() - inicio.current;
        setSegundos(Math.floor(transcurrido / 1000));
        if (transcurrido >= MAX_AUDIO_MS && recorder.state === "recording") recorder.stop();
      }, 250);
    } catch (fallo) {
      soltarMicrofono();
      setEstado({ fase: "inactivo" });
      setError(mensajeDeMicrofono(fallo instanceof Error ? fallo.name : ""));
    }
  }, [soltarMicrofono]);

  const terminarGrabacion = useCallback(() => {
    descartar.current = false;
    if (grabador.current?.state === "recording") grabador.current.stop();
  }, []);

  const cancelar = useCallback(() => {
    setError("");
    if (grabador.current?.state === "recording") {
      descartar.current = true;
      grabador.current.stop();
      return;
    }
    setEstado({ fase: "inactivo" });
  }, []);

  return {
    estado,
    error,
    segundos,
    elegirFoto,
    enviarFoto,
    iniciarGrabacion,
    terminarGrabacion,
    cancelar,
    limpiarError: () => setError(""),
  };
}
