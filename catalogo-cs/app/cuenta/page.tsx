import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import AvisoCorreoPendiente from "@/components/cliente/AvisoCorreoPendiente";
import CerrarSesion from "@/components/ui/CerrarSesion";
import { apiFetch } from "@/lib/api-server";
import { getCurrentUser } from "@/lib/auth";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Mi cuenta | Colombia Sexys",
  robots: { index: false },
};

type CuentaCliente = {
  id: string;
  email: string;
  nombre: string | null;
  correoVerificado: boolean;
};

export default async function CuentaPage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar");
  // Cada rol tiene su sitio: el personal no tiene nada que hacer aqui.
  if (usuario.rol !== "cliente") redirect(inicioParaRol(usuario.rol));

  const cuenta = await apiFetch<CuentaCliente>("/client-accounts/me", {
    loginPath: "/ingresar",
  });

  return (
    <main className="min-h-dvh bg-[#050505] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C5A55A]/60">
              Mi cuenta
            </p>
            <h1 className="mt-2 font-heading text-3xl font-semibold text-white">
              {cuenta.nombre || "Bienvenido"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{cuenta.email}</p>
          </div>
          <CerrarSesion destino="/" />
        </header>

        {cuenta.correoVerificado ? null : (
          <AvisoCorreoPendiente email={cuenta.email} />
        )}

        <Link
          href="/"
          className="inline-block rounded-lg border border-[#C5A55A]/60 px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black"
        >
          Ver el catálogo
        </Link>
      </div>
    </main>
  );
}
