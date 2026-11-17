import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthShell from "@/components/cliente/AuthShell";
import RegistroForm from "@/components/cliente/RegistroForm";
import { getCurrentUser } from "@/lib/auth";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Crear cuenta | Colombia Sexys",
  robots: { index: false },
};

export default async function RegistroPage() {
  const usuario = await getCurrentUser();
  if (usuario) redirect(inicioParaRol(usuario.rol));

  return (
    <AuthShell etiqueta="Acceso exclusivo" titulo="Crear cuenta">
      <RegistroForm />
    </AuthShell>
  );
}
