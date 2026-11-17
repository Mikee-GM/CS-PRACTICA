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
 * Por que se llega al login desde un pase de acceso que ya no sirve. Los pases
 * los manda el bot mientras siga vivo; antes caian en el login del panel.
 */
const AVISO_DEL_PASE: Record<string, string> = {
  caducado:
    "El enlace de acceso ya se usó o caducó. Inicia sesión con tu correo y tu contraseña.",
  error:
    "No se pudo abrir el enlace de acceso. Inicia sesión con tu correo y tu contraseña.",
};

/**
 * Login unico de todos los roles: personal y clientes entran aqui, y cada uno
 * aterriza en su inicio (`destinoTrasEntrar`). `/admin` sin sesion redirige a
 * esta pagina.
 */
export default async function IngresarPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string; acceso?: string }>;
}) {
  const { siguiente, acceso } = await searchParams;
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

  const aviso = acceso ? AVISO_DEL_PASE[acceso] : undefined;

  return (
    <AuthShell etiqueta="Bienvenido de nuevo" titulo="Iniciar sesión">
      {aviso ? (
        <p
          role="status"
          className="mb-6 rounded-lg border border-[#C5A55A]/30 bg-[#C5A55A]/5 px-4 py-3 text-xs leading-relaxed text-[#E8D5A3]"
        >
          {aviso}
        </p>
      ) : null}
      <IngresarForm siguiente={destinoSeguroDelCliente(siguiente)} />
    </AuthShell>
  );
}
