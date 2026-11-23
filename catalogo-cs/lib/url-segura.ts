/**
 * Devuelve la URL solo si es http o https; si no, `null`.
 *
 * Un enlace guardado como `javascript:...` o `data:...` ejecutaria codigo al
 * abrirlo desde la ficha publica. El backend ya lo rechaza al guardar; esto
 * cubre lo que hubiera quedado guardado antes.
 */
export function urlWebSegura(valor: string | null | undefined): string | null {
  if (!valor) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
