"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ComponentProps } from "react";

import { cambiarContrasenaAction } from "@/lib/actions/perfil-cliente";
import { esRedireccion } from "@/lib/es-redireccion";
import {
  errorAlCambiarContrasena,
  MENSAJE_CONTRASENA_CAMBIADA,
  MENSAJE_CONTRASENA_REPETIDA,
  PATRON_CONTRASENA,
} from "@/lib/perfil-cliente";
import Campo, {
  botonPrimario,
  ErrorDeFormulario,
  ExitoDeFormulario,
} from "./Campo";

/** Campo de contraseña con su boton para ver lo escrito. */
function CampoContrasena(
  props: Omit<ComponentProps<typeof Campo>, "type">,
) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <div>
      <Campo {...props} type={mostrar ? "text" : "password"} />
      <button
        type="button"
        onClick={() => setMostrar((v) => !v)}
        aria-pressed={mostrar}
        className="ml-1 inline-flex min-h-11 items-center text-xs font-medium text-[#C5A55A] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]"
      >
        {mostrar ? "Ocultar contraseña" : "Mostrar contraseña"}
      </button>
    </div>
  );
}

/**
 * Cambio de contraseña con la sesion abierta.
 *
 * Lleva el correo en un campo `username` oculto: sin el, el gestor de
 * contraseñas no sabe a que cuenta pertenece la nueva y no ofrece
 * actualizarla. Tras el exito los campos se vacian (se vuelven a montar, para
 * que tampoco quede el estado de validacion del intento anterior); si falla,
 * lo escrito se conserva.
 */
export default function FormContrasena({ email }: { email: string }) {
  const [vuelta, setVuelta] = useState(0);
  const [exito, setExito] = useState("");
  const [errorServidor, setErrorServidor] = useState("");
  const [pendiente, startTransition] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  // Al vaciar los campos se desmonta el que tenia el foco (quien envia con
  // Enter lo tiene en la nueva contraseña) y el foco caeria al inicio de la
  // pagina. Se deja en el boton, junto al aviso de exito.
  useEffect(() => {
    if (vuelta === 0) return;
    if (!formulario.current?.contains(document.activeElement)) {
      boton.current?.focus();
    }
  }, [vuelta]);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const actual = String(datos.get("actual") ?? "");
    const nueva = String(datos.get("nueva") ?? "");
    setExito("");
    setErrorServidor("");
    if (actual === nueva) {
      setErrorServidor(MENSAJE_CONTRASENA_REPETIDA);
      return;
    }

    startTransition(async () => {
      try {
        const resultado = await cambiarContrasenaAction(actual, nueva);
        if (resultado.success) {
          setVuelta((v) => v + 1);
          setExito(MENSAJE_CONTRASENA_CAMBIADA);
        } else {
          setErrorServidor(resultado.error);
        }
      } catch (error) {
        if (esRedireccion(error)) throw error;
        setErrorServidor(errorAlCambiarContrasena(null));
      }
    });
  }

  return (
    <form ref={formulario} onSubmit={enviar} className="space-y-4">
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />

      <div key={vuelta} className="space-y-4">
        <CampoContrasena
          etiqueta="Contraseña actual"
          name="actual"
          autoComplete="current-password"
          enterKeyHint="next"
          required
          error="Escribe tu contraseña actual."
        />
        <CampoContrasena
          etiqueta="Nueva contraseña"
          name="nueva"
          autoComplete="new-password"
          enterKeyHint="done"
          required
          minLength={8}
          maxLength={72}
          pattern={PATRON_CONTRASENA}
          ayuda="De 8 a 72 caracteres, con al menos una letra y un número."
          error="La contraseña no cumple los requisitos indicados arriba."
        />
      </div>

      <ErrorDeFormulario mensaje={errorServidor} />
      <ExitoDeFormulario mensaje={exito} />

      <button
        ref={boton}
        type="submit"
        disabled={pendiente}
        aria-busy={pendiente}
        className={botonPrimario}
      >
        {pendiente ? "Actualizando" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
