"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { verificarCorreoAction } from "@/lib/actions/cliente-auth";
import { botonPrimario, ErrorDeFormulario } from "./Campo";

/**
 * Canje manual del enlace del correo.
 *
 * Es un boton y no una llamada automatica al cargar: los antivirus y las
 * previsualizaciones de enlaces abren las URL de los correos, y una
 * confirmacion que ocurriera sola podria gastarse antes de que la persona
 * llegue. Es la misma razon por la que el backend lo recibe por POST.
 */
export default function ConfirmarCorreo({ token }: { token: string }) {
  const [estado, setEstado] = useState<"espera" | "listo">("espera");
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();

  function confirmar() {
    setError("");
    startTransition(async () => {
      const resultado = await verificarCorreoAction(token);
      if (resultado.success) setEstado("listo");
      else setError(resultado.error);
    });
  }

  if (estado === "listo") {
    return (
      <div className="space-y-6 text-center" role="status">
        <p className="text-sm text-zinc-300">
          Tu correo quedó confirmado. Ya puedes seguir con tu cuenta.
        </p>
        <Link href="/cuenta" className={botonPrimario}>
          Ir a mi cuenta
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-center text-sm text-zinc-400">
        Confirma que este correo es tuyo para completar tu cuenta.
      </p>
      <ErrorDeFormulario mensaje={error} />
      <button
        type="button"
        onClick={confirmar}
        disabled={pendiente}
        aria-busy={pendiente}
        className={botonPrimario}
      >
        {pendiente ? "Confirmando" : "Confirmar mi correo"}
      </button>
    </div>
  );
}
