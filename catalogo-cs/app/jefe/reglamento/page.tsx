import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import PaginaDeReglamento from "@/components/reglamento/PaginaDeReglamento";
import { getCurrentUser } from "@/lib/auth";
import { inicioParaRol } from "@/lib/roles";

export const metadata = {
  title: "Reglamento -- Panel de jefe",
  robots: "noindex, nofollow",
};

export default async function JefeReglamentoPage() {
  const sesion = await getCurrentUser();
  if (!sesion) redirect("/ingresar");
  if (sesion.rol !== "jefe" && sesion.rol !== "admin") {
    redirect(inicioParaRol(sesion.rol));
  }

  // El backend responde 403 al admin en este endpoint: no se le consulta.
  if (sesion.rol === "admin") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-5">
        <Link
          href="/jefe/ajustes"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-[#C5A55A]"
        >
          <ArrowLeft size={14} />
          Ajustes
        </Link>
        <div className="rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-6 text-center text-sm text-zinc-400">
          El administrador no tiene reglamento propio.
        </div>
      </div>
    );
  }

  return <PaginaDeReglamento volverA="/jefe/ajustes" volverTexto="Ajustes" />;
}
