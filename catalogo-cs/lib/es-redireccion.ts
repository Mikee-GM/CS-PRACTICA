/**
 * La redireccion de una Server Action viaja al cliente como una excepcion con
 * este `digest`. Los formularios tienen que dejarla pasar: tratarla como un
 * fallo pintaria un error encima de una accion que si funciono.
 *
 * Vive aparte de `lib/auth.ts` porque ese modulo importa `next/headers` y no se
 * puede cargar desde un componente de cliente.
 */
export function esRedireccion(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
