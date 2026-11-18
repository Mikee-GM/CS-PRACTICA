import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getMiReglamento } from "@/lib/actions/reglamento";
import { optionalSource } from "@/lib/optional-source";
import VistaReglamento from "./VistaReglamento";

/**
 * Marco comun de las tres pantallas de reglamento (empleada, chofer y jefe).
 *
 * Lee aqui para que cada ruta solo decida la sesion y el rol. Un fallo de red
 * se degrada a `null` y la vista lo avisa; la redireccion por sesion caducada
 * se reemite.
 */
export default async function PaginaDeReglamento({
  volverA,
  volverTexto,
}: {
  volverA: string;
  volverTexto: string;
}) {
  const datos = await optionalSource(getMiReglamento(), null, "reglamento");

  return (
    <div className="mx-auto w-full max-w-lg space-y-5">
      <Link
        href={volverA}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-[#C5A55A]"
      >
        <ArrowLeft size={14} />
        {volverTexto}
      </Link>
      <VistaReglamento datos={datos} />
    </div>
  );
}
