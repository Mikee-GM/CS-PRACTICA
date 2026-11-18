import { redirect } from "next/navigation";

import PaginaDeReglamento from "@/components/reglamento/PaginaDeReglamento";
import { getCurrentUser } from "@/lib/auth";
import { inicioParaRol } from "@/lib/roles";

export const metadata = {
  title: "Reglamento -- Mi Portal",
  robots: "noindex, nofollow",
};

export default async function EmpleadaReglamentoPage() {
  const sesion = await getCurrentUser();
  if (!sesion) redirect("/ingresar");
  if (sesion.rol !== "empleada") redirect(inicioParaRol(sesion.rol));

  return (
    <div className="min-h-dvh bg-[#0B0D13] p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-gray-100 sm:p-6 sm:pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <PaginaDeReglamento volverA="/empleada/portal" volverTexto="Mi portal" />
    </div>
  );
}
