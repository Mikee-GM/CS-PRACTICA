import { sniffImageContentType } from './upload.service';

/** Una foto del chat. Las fotos del telefono llegan comprimidas del navegador. */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Una nota de voz de unos minutos ocupa menos de 2 MB; este es el margen. */
export const CHAT_AUDIO_MAX_BYTES = 8 * 1024 * 1024;

export type ChatMediaKind = 'foto' | 'audio';

export const CHAT_MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const MARCAS_DE_AUDIO_MP4 = new Set([
  'M4A ',
  'M4B ',
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'dash',
]);

/**
 * Tipo real de un audio por sus primeros bytes, o `null` si no es uno que los
 * navegadores sepan reproducir.
 *
 * WebM y MP4 pueden contener audio o video con la misma cabecera, asi que esos
 * dos solo se aceptan si el navegador los declaro como `audio/*`: es lo unico
 * que los distingue. Aun asi el tipo que se guarda es el deducido, nunca el que
 * llega, porque el bucket es publico.
 */
export function sniffAudioContentType(
  buffer: Buffer,
  declarado: string,
): string | null {
  const esAudioDeclarado = declarado.startsWith('audio/');
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') {
    return 'audio/ogg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return 'audio/mpeg';
  }
  // Fotograma MPEG sin etiqueta: once bits de sincronia.
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  if (
    esAudioDeclarado &&
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'audio/webm';
  }
  if (
    esAudioDeclarado &&
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    MARCAS_DE_AUDIO_MP4.has(buffer.toString('ascii', 8, 12))
  ) {
    return 'audio/mp4';
  }
  return null;
}

/**
 * Que es el archivo que se adjunta al chat, decidido por sus bytes. El tipo
 * declarado solo desempata WebM y MP4 (audio frente a video).
 */
export function clasificarMediaDeChat(
  buffer: Buffer,
  declarado: string,
): { kind: ChatMediaKind; mimeType: string } | null {
  const tipo = declarado.split(';')[0].trim().toLowerCase();
  const imagen = sniffImageContentType(buffer);
  if (imagen) return { kind: 'foto', mimeType: imagen };
  const audio = sniffAudioContentType(buffer, tipo);
  if (audio) return { kind: 'audio', mimeType: audio };
  return null;
}
