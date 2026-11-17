import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthShell from "@/components/cliente/AuthShell";
import IngresarForm from "@/components/cliente/IngresarForm";
import { getCurrentUser } from "@/lib/auth";
import { destinoSeguroDelCliente } from "@/lib/destino-cliente";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Iniciar sesión | Colombia Sexys",
  robots: { index: false },
};

export default async function IngresarPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string }>;
}) {
  const destino = destinoSeguroDelCliente((await searchParams).siguiente);
  const usuario = await getCurrentUser();
  if (usuario) {
    redirect(
      (usuario.rol === "cliente" ? destino : null) ?? inicioParaRol(usuario.rol),
    );
  }

  return (
    <AuthShell etiqueta="Bienvenido de nuevo" titulo="Iniciar sesión">
      <IngresarForm siguiente={destino} />
    </AuthShell>
  );
}
