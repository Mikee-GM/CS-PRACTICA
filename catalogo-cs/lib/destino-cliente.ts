/**
 * Destino tras entrar o registrarse, cuando el cliente venia de algun sitio.
 *
 * El valor llega por la URL (`/ingresar?siguiente=...`), asi que lo controla
 * cualquiera que mande un enlace. Aceptar una ruta arbitraria convertiria el
 * login en un trampolin: `//otro-sitio` o `/\otro-sitio` los navegadores los
 * leen como otro dominio, y con la sesion recien abierta seria un salto
 * regalado. Por eso no se valida la forma, se admite una lista cerrada: solo las
 * pantallas del cliente. Cualquier otra cosa cae al inicio normal.
 */
const PREFIJOS_PERMITIDOS = ["/chats", "/cuenta"] as const;

/** Ids de conversacion y de modelo: uuids o slugs sencillos. */
const SEGMENTO_SEGURO = /^[A-Za-z0-9-]+$/;

export function destinoSeguroDelCliente(
  siguiente: string | null | undefined,
): string | null {
  if (!siguiente || siguiente.length > 200) return null;

  let url: URL;
  try {
    // Una base ficticia: si la ruta trae su propio origen, deja de ser este.
    url = new URL(siguiente, "https://interno.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://interno.invalid") return null;
  if (!siguiente.startsWith("/") || siguiente.startsWith("//")) return null;

  const ruta = url.pathname;
  const permitido = PREFIJOS_PERMITIDOS.some(
    (prefijo) => ruta === prefijo || ruta.startsWith(`${prefijo}/`),
  );
  if (!permitido) return null;
  if (!ruta.split("/").slice(1).every((s) => SEGMENTO_SEGURO.test(s))) {
    return null;
  }

  // De la consulta solo se conserva `modelo`, que es lo que usa `/chats`.
  const modelo = url.searchParams.get("modelo");
  if (modelo && SEGMENTO_SEGURO.test(modelo)) {
    return `${ruta}?modelo=${modelo}`;
  }
  return ruta;
}
