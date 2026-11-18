"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  Clock3,
  Plus,
  Rows3,
  UsersRound,
  WalletCards,
} from "lucide-react";
import CreateServiceDialog from "@/components/services/create-service-dialog";
import WorkShiftToggle from "@/components/ui/WorkShiftToggle";
import type { WorkShiftStatus } from "@/lib/actions/work-shift";
import type { Employee } from "@/lib/types";

const secondaryLinks = [
  { href: "/jefe/equipo", label: "Equipo", icon: UsersRound },
  { href: "/jefe/caja", label: "Caja", icon: WalletCards },
  { href: "/jefe/historial", label: "Historial", icon: Clock3 },
];

export default function TodayHeader({
  workShift,
  employees,
}: {
  workShift: WorkShiftStatus | null;
  /** Equipo del jefe: el dialogo de alta lo ofrece como modelos asignables. */
  employees: Employee[];
}) {
  const router = useRouter();
  const [creatingService, setCreatingService] = useState(false);

  return (
    <>
    <header className="mb-2 flex min-h-11 items-center gap-2 sm:mb-3">
      <div className="w-[112px] shrink-0 sm:w-[170px]">
        <WorkShiftToggle initialStatus={workShift} compacto />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <details className="group relative">
          <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-zinc-800 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:border-[#C5A55A] hover:text-[#C5A55A] sm:w-auto sm:px-3">
            <Rows3 size={15} />
            <span className="hidden sm:inline">Secciones</span>
            <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute right-0 z-40 mt-2 w-48 overflow-hidden rounded-xl border border-zinc-800 bg-[#080808] p-1.5 shadow-2xl">
            {secondaryLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white"
              >
                <Icon size={14} /> {label}
              </Link>
            ))}
            <Link
              href="/jefe/grupos"
              className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              <UsersRound size={14} /> Servicios grupales
            </Link>
          </div>
        </details>
        <Link
          href="/jefe/ajustes"
          aria-label="Ajustes: avisos y seguridad"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 hover:border-[#C5A55A] hover:text-[#C5A55A]"
        >
          <Bell size={16} />
        </Link>
        <button
          type="button"
          aria-label="Crear servicio"
          onClick={() => setCreatingService(true)}
          className="flex h-11 items-center gap-2 rounded-xl border border-[#C5A55A]/60 px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black"
        >
          <Plus size={15} />
          <span className="hidden sm:inline">Crear servicio</span>
        </button>
      </div>
    </header>
    <CreateServiceDialog
      open={creatingService}
      onClose={() => setCreatingService(false)}
      initialEmployees={employees}
      onCreated={() => router.refresh()}
    />
    </>
  );
}
