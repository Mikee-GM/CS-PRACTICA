import { redirect } from "next/navigation";

import { destinoTrasEntrar, RUTA_LOGIN } from "@/lib/acceso-personal";
import { getCurrentUser } from "@/lib/auth";

/**
 * `/admin` ya no es un login: hay uno solo para todos los roles, `/ingresar`.
 *
 * El middleware resuelve esta ruta antes de llegar aqui. Esto solo cubre el
 * caso de que no corra (por ejemplo, una prueba que renderice la pagina sola):
 * nunca se pinta el marco del panel sin decidir antes a donde va la sesion.
 */
export default async function AdminPage() {
  const usuario = await getCurrentUser();
  redirect(
    destinoTrasEntrar({
      rol: usuario?.rol,
      debeCambiarPassword: usuario?.debeCambiarPassword,
    }) ?? RUTA_LOGIN,
  );
}
