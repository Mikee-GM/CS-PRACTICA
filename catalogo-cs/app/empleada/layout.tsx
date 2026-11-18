import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { debeCambiarAntesDeSeguir, RUTA_CAMBIO_FORZADO } from "@/lib/acceso-personal";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  robots: "noindex, nofollow",
  manifest: "/manifest-empleada.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mi Portal",
    statusBarStyle: "black-translucent",
  },
};

/**
 * Cambio de contraseña obligatorio, en el portal.
 *
 * El middleware lo impone en el panel y en el area del cliente, donde ya
 * pregunta a `/auth/me` por el rol; en los portales no pregunta --solo renueva
 * la sesion-- y añadirle esa consulta costaria una peticion mas en cada
 * navegacion. Aqui sale gratis: `getCurrentUser` esta deduplicado por peticion
 * y las paginas del portal ya lo llaman.
 */
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getCurrentUser();
  if (usuario && debeCambiarAntesDeSeguir(usuario.rol, usuario.debeCambiarPassword)) {
    redirect(RUTA_CAMBIO_FORZADO);
  }
  return children;
}
