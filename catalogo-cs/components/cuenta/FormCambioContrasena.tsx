"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ComponentProps } from "react";

import Campo, {
  botonPrimario,
  ErrorDeFormulario,
  ExitoDeFormulario,
} from "@/components/cliente/Campo";
import { cambiarContrasenaPropiaAction } from "@/lib/actions/acceso-personal";
import {
  AYUDA_CONTRASENA,
  errorAlCambiarContrasenaPropia,
  LARGO_MAXIMO_CONTRASENA,
  LARGO_MINIMO_CONTRASENA,
  MENSAJE_CONTRASENA_CAMBIADA,
  PATRON_CONTRASENA,
  validarContrasenaNueva,
} from "@/lib/acceso-personal";
import { esRedireccion } from "@/lib/es-redireccion";

/** Campo de contraseña con su boton para ver lo escrito. */
function CampoContrasena(props: Omit<ComponentProps<typeof Campo>, "type">) {
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
 * Cambio de contraseña del personal (admin, jefe, modelo y chofer).
 *
 * Lo usan la pantalla bloqueante del primer acceso (`forzado`) y la seccion
 * "Seguridad" de los ajustes de cada rol. El del cliente vive aparte
 * (`components/cliente/FormContrasena`) porque habla con otro endpoint.
 *
 * - Lleva el correo en un campo `username` oculto: sin el, el gestor de
 *   contraseñas no sabe a que cuenta pertenece la nueva y no ofrece guardarla.
 * - `current-password` y `new-password` separan los dos campos para el
 *   autocompletado; con `new-password` el navegador puede proponer una fuerte.
 * - Forzado, el exito navega desde el servidor y este componente no vuelve a
 *   pintarse; en los ajustes los campos se vacian (se vuelven a montar, para
 *   que no quede el estado de validacion del intento anterior) y se anuncia el
 *   exito. Si falla, lo escrito se conserva.
 */
export default function FormCambioContrasena({
  email,
  forzado = false,
}: {
  email: string;
  forzado?: boolean;
}) {
  const [vuelta, setVuelta] = useState(0);
  const [exito, setExito] = useState("");
  const [errorServidor, setErrorServidor] = useState("");
  const [pendiente, startTransition] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  // Al vaciar los campos se desmonta el que tenia el foco y caeria al inicio
  // de la pagina. Se deja en el boton, junto al aviso de exito.
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

    // Lo que ningun atributo HTML expresa: que la nueva sea distinta.
    const invalida = validarContrasenaNueva(actual, nueva);
    if (invalida) {
      setErrorServidor(invalida);
      return;
    }

    startTransition(async () => {
      try {
        const resultado = await cambiarContrasenaPropiaAction(actual, nueva, {
          forzado,
        });
        if (resultado.success) {
          setVuelta((v) => v + 1);
          setExito(MENSAJE_CONTRASENA_CAMBIADA);
        } else {
          setErrorServidor(resultado.error);
        }
      } catch (error) {
        if (esRedireccion(error)) throw error;
        setErrorServidor(errorAlCambiarContrasenaPropia(null));
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
          etiqueta={forzado ? "Contraseña temporal" : "Contraseña actual"}
          ayuda={
            forzado
              ? "La que te entregó administración o tu jefe para este primer acceso."
              : undefined
          }
          name="actual"
          autoComplete="current-password"
          enterKeyHint="next"
          required
          // En la pantalla bloqueante no hay nada mas que hacer: el foco va
          // directo al primer campo.
          autoFocus={forzado}
          error={
            forzado
              ? "Escribe la contraseña temporal con la que entraste."
              : "Escribe tu contraseña actual."
          }
        />
        <CampoContrasena
          etiqueta="Nueva contraseña"
          name="nueva"
          autoComplete="new-password"
          enterKeyHint="done"
          required
          minLength={LARGO_MINIMO_CONTRASENA}
          maxLength={LARGO_MAXIMO_CONTRASENA}
          pattern={PATRON_CONTRASENA}
          ayuda={AYUDA_CONTRASENA}
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
        {pendiente
          ? "Actualizando"
          : forzado
            ? "Guardar y continuar"
            : "Cambiar contraseña"}
      </button>
    </form>
  );
}
