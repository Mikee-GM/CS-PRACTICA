import type { Metadata } from "next";
import Link from "next/link";

import AuthShell from "@/components/cliente/AuthShell";
import ConfirmarCorreo from "@/components/cliente/ConfirmarCorreo";

export const metadata: Metadata = {
  title: "Confirmar correo | Colombia Sexys",
  robots: { index: false },
  // El token viaja en la URL: que no se filtre en la cabecera Referer.
  referrer: "no-referrer",
};

const TOKEN_VALIDO = /^[0-9a-f]{64}$/;

export default async function VerificarCorreoPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell etiqueta="Tu cuenta" titulo="Confirmar correo">
      {token && TOKEN_VALIDO.test(token) ? (
        <ConfirmarCorreo token={token} />
      ) : (
        <div className="space-y-5 text-center">
          <p role="alert" className="text-sm text-red-400">
            El enlace no es válido. Pide uno nuevo desde tu cuenta.
          </p>
          <Link
            href="/cuenta"
            className="inline-block text-xs font-medium text-[#C5A55A] underline-offset-4 hover:underline"
          >
            Ir a mi cuenta
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
