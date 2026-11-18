import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthShell from "@/components/cliente/AuthShell";
import IngresarForm from "@/components/cliente/IngresarForm";
import { destinoTrasEntrar } from "@/lib/acceso-personal";
import { getCurrentUser } from "@/lib/auth";
import { destinoSeguroDelCliente } from "@/lib/destino-cliente";

export const metadata: Metadata = {
  title: "Iniciar sesión | Colombia Sexys",
  robots: { index: false },
};

/**
 * Login unico de todos los roles: personal y clientes entran aqui, y cada uno
 * aterriza en su inicio (`destinoTrasEntrar`). `/admin` sin sesion redirige a
 * esta pagina.
 */
export default async function IngresarPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string }>;
}) {
  const { siguiente } = await searchParams;
  const usuario = await getCurrentUser();
  if (usuario) {
    // Un rol sin destino se queda en el login: mandarlo a otro sitio que lo
    // devuelva aqui seria un bucle.
    const destino = destinoTrasEntrar({
      rol: usuario.rol,
      debeCambiarPassword: usuario.debeCambiarPassword,
      siguiente,
    });
    if (destino) redirect(destino);
  }

  return (
    <AuthShell etiqueta="Bienvenido de nuevo" titulo="Iniciar sesión">
      <IngresarForm siguiente={destinoSeguroDelCliente(siguiente)} />
    </AuthShell>
  );
}
