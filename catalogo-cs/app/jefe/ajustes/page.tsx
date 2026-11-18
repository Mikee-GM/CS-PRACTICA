import Link from "next/link";
import { ChevronRight } from "lucide-react";

import SeccionSeguridad from "@/components/cuenta/SeccionSeguridad";
import PaginaDeAvisos from "@/components/ui/PaginaDeAvisos";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: "Avisos -- Panel de jefe",
  robots: "noindex, nofollow",
};

export default async function JefeAjustesPage() {
  // El middleware ya exige sesion de jefe; sin respuesta del backend se
  // pintan los avisos y se omite la seccion que necesita el correo.
  const usuario = await getCurrentUser();
  return (
    <PaginaDeAvisos volverA="/jefe" volverTexto="Mi equipo">
      <Link
        href="/jefe/reglamento"
        className="flex min-h-11 items-center justify-between rounded-2xl border border-zinc-800 bg-[#0A0A0A] px-4 py-3 text-sm font-semibold text-zinc-200 transition-colors hover:border-[#C5A55A] hover:text-[#C5A55A]"
      >
        Reglamento y cuestionario
        <ChevronRight size={16} aria-hidden />
      </Link>
      {usuario ? <SeccionSeguridad email={usuario.email} /> : null}
    </PaginaDeAvisos>
  );
}
