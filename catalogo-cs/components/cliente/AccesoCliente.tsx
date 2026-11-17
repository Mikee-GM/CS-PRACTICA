"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { sesionDelVisitanteAction } from "@/lib/actions/cliente-auth";
import { inicioParaRol } from "@/lib/roles";

const enlace =
  "inline-flex min-h-11 items-center rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60";

/**
 * Accesos discretos del catalogo: entrar o crear cuenta, o ir a los chats si
 * ya hay sesion.
 *
 * El catalogo se sirve estatico (ISR), asi que la sesion se pregunta despues
 * de montar. Mientras no se sabe no se pinta nada: enseñar "Iniciar sesión" a
 * quien ya entro y cambiarlo un instante despues confunde mas que esperar.
 */
export default function AccesoCliente() {
  const [sesion, setSesion] = useState<
    { cargada: false } | { cargada: true; rol: string | null }
  >({ cargada: false });

  useEffect(() => {
    let vigente = true;
    sesionDelVisitanteAction()
      .then((s) => vigente && setSesion({ cargada: true, rol: s?.rol ?? null }))
      // Sin respuesta se ofrece entrar: es lo que sirve a la mayoria.
      .catch(() => vigente && setSesion({ cargada: true, rol: null }));
    return () => {
      vigente = false;
    };
  }, []);

  if (!sesion.cargada) return null;

  return (
    <nav
      aria-label="Tu cuenta"
      className="flex items-center gap-1 rounded-full border border-zinc-800/80 bg-black/60 p-1 backdrop-blur-md"
    >
      {sesion.rol === null ? (
        <>
          <Link href="/ingresar" className={`${enlace} text-zinc-300 hover:text-[#E8D5A3]`}>
            Iniciar sesión
          </Link>
          <Link
            href="/registro"
            className={`${enlace} border border-[#C5A55A]/50 text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black`}
          >
            Crear cuenta
          </Link>
        </>
      ) : sesion.rol === "cliente" ? (
        <Link
          href="/chats"
          className={`${enlace} border border-[#C5A55A]/50 text-[#C5A55A] hover:bg-[#C5A55A] hover:text-black`}
        >
          Mis chats
        </Link>
      ) : (
        <Link
          href={inicioParaRol(sesion.rol)}
          className={`${enlace} text-zinc-300 hover:text-[#E8D5A3]`}
        >
          Mi panel
        </Link>
      )}
    </nav>
  );
}
