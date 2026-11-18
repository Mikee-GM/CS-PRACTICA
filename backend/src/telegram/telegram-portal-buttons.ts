import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';

/**
 * Enlace normal a una ruta del panel web, sin ninguna credencial incrustada.
 *
 * Telegram guarda el historial y los mensajes se reenvian, asi que un enlace
 * que entrara solo seria una llave en un sitio que no controlamos. Quien lo
 * abre inicia sesion con su correo y contrasena como en cualquier navegador.
 */
export function enlaceDelPanel(webUrl: string, ruta: string): string {
  return `${webUrl.replace(/\/+$/, '')}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
}

/**
 * Botonera para abrir un portal desde Telegram.
 *
 * Solo boton de navegador (url): ya no se ofrece Mini App. Admite http para
 * poder entrar mientras se corrige un origen mal configurado.
 */
export function botonesDePortal(
  url: string,
  /** Texto del boton. Se personaliza cuando el enlace aterriza en una seccion concreta. */
  etiqueta = 'Abrir mi portal',
): InlineKeyboardButton[][] {
  return [[Markup.button.url(etiqueta, url)]];
}
