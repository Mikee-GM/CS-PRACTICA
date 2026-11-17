"use client";

import { useState, useTransition } from "react";

import { reenviarVerificacionAction } from "@/lib/actions/cliente-auth";
import { esRedireccion } from "@/lib/es-redireccion";

/** Recordatorio discreto: el correo sin confirmar no bloquea nada. */
export default function AvisoCorreoPendiente({ email }: { email: string }) {
  const [mensaje, setMensaje] = useState("");
  const [esError, setEsError] = useState(false);
  const [pendiente, startTransition] = useTransition();

  function reenviar() {
    setMensaje("");
    startTransition(async () => {
      try {
        const resultado = await reenviarVerificacionAction();
        setEsError(!resultado.success);
        setMensaje(
          resultado.success
            ? "Te enviamos un nuevo enlace. Revisa tu bandeja."
            : resultado.error,
        );
      } catch (error) {
        if (esRedireccion(error)) throw error;
        setEsError(true);
        setMensaje("No se pudo enviar el correo. Intenta de nuevo.");
      }
    });
  }

  return (
    <section
      aria-labelledby="aviso-correo"
      className="rounded-xl border border-[#C5A55A]/30 bg-[#C5A55A]/5 p-5"
    >
      <h2
        id="aviso-correo"
        className="font-heading text-lg font-semibold text-[#E8D5A3]"
      >
        Confirma tu correo
      </h2>
      <p className="mt-2 text-sm text-zinc-400">
        Enviamos un enlace a <span className="text-zinc-200">{email}</span>.
        Puedes seguir usando tu cuenta mientras tanto.
      </p>
      <button
        type="button"
        onClick={reenviar}
        disabled={pendiente}
        aria-busy={pendiente}
        className="mt-4 rounded-lg border border-[#C5A55A]/60 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black disabled:opacity-50"
      >
        Reenviar enlace
      </button>
      {mensaje ? (
        <p
          role={esError ? "alert" : "status"}
          className={`mt-3 text-xs ${esError ? "text-red-400" : "text-zinc-400"}`}
        >
          {mensaje}
        </p>
      ) : null}
    </section>
  );
}
