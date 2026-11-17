import { randomInt } from 'crypto';

/**
 * Alfabeto de la contraseña temporal: sin 0/O/o, 1/l/I ni similares, porque
 * quien la recibe la copia a mano desde lo que le dicta o le enseña el admin.
 */
const LETRAS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITOS = '23456789';
const ALFABETO = LETRAS + DIGITOS;

/** 14 simbolos de 56 son ~81 bits: de sobra para algo que se cambia al entrar. */
export const LONGITUD_PASSWORD_TEMPORAL = 14;

/**
 * Contraseña temporal aleatoria que cumple las mismas reglas que una elegida
 * por la persona (8..72, al menos una letra y un numero), para que el cambio
 * forzado no rechace como "actual" algo que el propio sistema genero.
 *
 * `randomInt` y no `Math.random`: es la llave de una cuenta. Se repite hasta
 * tener letra y numero en lugar de fijar posiciones, que haria predecible
 * donde cae cada tipo.
 */
export function generarPasswordTemporal(
  longitud = LONGITUD_PASSWORD_TEMPORAL,
): string {
  for (;;) {
    let password = '';
    for (let i = 0; i < longitud; i += 1) {
      password += ALFABETO[randomInt(ALFABETO.length)];
    }
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) return password;
  }
}
