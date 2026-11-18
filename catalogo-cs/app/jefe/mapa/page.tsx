import LiveMapDynamic from "@/components/dashboard/LiveMapDynamic";
import { getJefeEmployees } from "@/lib/actions/jefe-panel";
import { getDrivers } from "@/lib/data/drivers";
import { optionalSource } from "@/lib/optional-source";
import type { Driver } from "@/lib/types";

export default async function JefeMapPage() {
  const [employees, drivers] = await Promise.all([
    getJefeEmployees(),
    optionalSource<Driver[]>(getDrivers(), [], "mapa del jefe"),
  ]);
  return <><header className="mb-7"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#C5A55A]">Seguimiento operativo</p><h1 className="font-heading text-4xl font-semibold sm:text-5xl">Ubicación del equipo</h1><p className="mt-2 text-sm text-zinc-500">Última ubicación reportada por tus empleadas y los choferes.</p></header><LiveMapDynamic employees={employees} drivers={drivers} /></>;
}
