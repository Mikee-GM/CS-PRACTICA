import { redirect } from "next/navigation";

import PaginaDeReglamento from "@/components/reglamento/PaginaDeReglamento";
import { getCurrentUser } from "@/lib/auth";
import { inicioParaRol } from "@/lib/roles";

export const metadata = {
  title: "Reglamento -- Portal de chofer",
  robots: "noindex, nofollow",
};

export default async function ChoferReglamentoPage() {
  const sesion = await getCurrentUser();
  if (!sesion) redirect("/ingresar");
  if (sesion.rol !== "chofer") redirect(inicioParaRol(sesion.rol));

  return (
    <div className="min-h-dvh bg-[#0B0D13] p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-gray-100 sm:p-6 sm:pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <PaginaDeReglamento volverA="/chofer/portal" volverTexto="Mi portal" />
    </div>
  );
}
