"use client";

import { useState, useTransition } from "react";

import { actualizarNombreAction } from "@/lib/actions/perfil-cliente";
import { esRedireccion } from "@/lib/es-redireccion";
import {
  errorAlCambiarNombre,
  LARGO_MAXIMO_NOMBRE,
  MENSAJE_NOMBRE_GUARDADO,
} from "@/lib/perfil-cliente";
import Campo, {
  botonPrimario,
  ErrorDeFormulario,
  ExitoDeFormulario,
} from "./Campo";

/**
 * Edicion del nombre en el sitio: el campo llega con el nombre actual y basta
 * con cambiarlo y guardar. Si el guardado falla, lo escrito se queda en el
 * campo para corregirlo sin volver a teclearlo.
 */
export default function FormNombre({ nombre }: { nombre: string | null }) {
  const [guardado, setGuardado] = useState(nombre ?? "");
  const [exito, setExito] = useState("");
  const [errorServidor, setErrorServidor] = useState("");
  const [pendiente, startTransition] = useTransition();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nuevo = String(new FormData(e.currentTarget).get("nombre") ?? "").trim();
    setExito("");
    setErrorServidor("");
    if (nuevo === guardado) {
      setExito("Tu nombre ya es ese; no había nada que guardar.");
      return;
    }

    startTransition(async () => {
      try {
        const resultado = await actualizarNombreAction(nuevo);
        if (resultado.success) {
          setGuardado(resultado.nombre);
          setExito(MENSAJE_NOMBRE_GUARDADO);
        } else {
          setErrorServidor(resultado.error);
        }
      } catch (error) {
        if (esRedireccion(error)) throw error;
        setErrorServidor(errorAlCambiarNombre(null));
      }
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo
        etiqueta="Nombre"
        name="nombre"
        type="text"
        autoComplete="name"
        enterKeyHint="done"
        required
        maxLength={LARGO_MAXIMO_NOMBRE}
        // Solo espacios no es un nombre; `pattern` exige coincidencia total.
        pattern=".*\S.*"
        defaultValue={nombre ?? ""}
        placeholder="Cómo quieres que te llamemos"
        error={`Escribe tu nombre, de hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`}
      />

      <ErrorDeFormulario mensaje={errorServidor} />
      <ExitoDeFormulario mensaje={exito} />

      <button
        type="submit"
        disabled={pendiente}
        aria-busy={pendiente}
        className={botonPrimario}
      >
        {pendiente ? "Guardando" : "Guardar nombre"}
      </button>
    </form>
  );
}
