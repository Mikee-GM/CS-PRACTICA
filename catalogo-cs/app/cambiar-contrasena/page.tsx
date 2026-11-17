import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthShell from "@/components/cliente/AuthShell";
import FormCambioContrasena from "@/components/cuenta/FormCambioContrasena";
import CerrarSesion from "@/components/ui/CerrarSesion";
import {
  redireccionPorCambioForzado,
  RUTA_CAMBIO_FORZADO,
} from "@/lib/acceso-personal";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Crea tu contraseña | Colombia Sexys",
  robots: { index: false },
};

/**
 * Cambio de contraseña obligatorio del primer acceso.
 *
 * Quien entra con una contraseña temporal --se la restablecio un admin o su
 * jefe-- solo puede ver esta pantalla hasta poner la suya: el middleware
 * devuelve aqui cualquier otra ruta. Por eso no hay navegacion ni enlaces al
 * panel; la unica salida, aparte de cambiarla, es cerrar la sesion.
 *
 * La comprobacion se repite aqui con la misma funcion que el middleware: si
 * este no corriera, la pagina tampoco debe pintarse para quien no la necesita.
 */
export default async function CambiarContrasenaPage() {
  const usuario = await getCurrentUser();
  const destino = redireccionPorCambioForzado(
    RUTA_CAMBIO_FORZADO,
    usuario
      ? {
          estado: "ok",
          rol: usuario.rol,
          debeCambiarPassword: usuario.debeCambiarPassword === true,
        }
      : { estado: "sin-sesion" },
  );
  if (destino || !usuario) redirect(destino ?? "/ingresar");

  return (
    <AuthShell
      etiqueta="Primer acceso"
      titulo="Crea tu contraseña"
      pie={
        <span className="inline-flex items-center gap-3">
          ¿No es tu cuenta o prefieres hacerlo después?
          <CerrarSesion />
        </span>
      }
    >
      <p className="mb-6 text-center text-sm leading-relaxed text-zinc-400">
        Entraste con una contraseña temporal. Antes de continuar, elige una
        contraseña propia que solo conozcas tú.
      </p>
      <FormCambioContrasena email={usuario.email} forzado />
    </AuthShell>
  );
}
