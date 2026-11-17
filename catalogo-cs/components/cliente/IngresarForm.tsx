"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { loginAction } from "@/lib/actions/auth";
import { esRedireccion } from "@/lib/es-redireccion";
import Campo, { botonPrimario, ErrorDeFormulario } from "./Campo";

export default function IngresarForm() {
  const [mostrar, setMostrar] = useState(false);
  const [errorServidor, setErrorServidor] = useState("");
  const [pendiente, startTransition] = useTransition();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    setErrorServidor("");

    startTransition(async () => {
      try {
        // Con credenciales validas la accion navega al inicio del rol y no vuelve.
        const resultado = await loginAction(
          String(datos.get("email") ?? ""),
          String(datos.get("password") ?? ""),
        );
        if (resultado && !resultado.success) {
          setErrorServidor(resultado.error ?? "Credenciales incorrectas");
        }
      } catch (error) {
        if (esRedireccion(error)) throw error;
        setErrorServidor("No se pudo iniciar sesión. Intenta de nuevo.");
      }
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      <Campo
        etiqueta="Correo electrónico"
        name="email"
        type="email"
        autoComplete="username"
        spellCheck={false}
        enterKeyHint="next"
        required
        placeholder="tucorreo@ejemplo.com"
        error="Escribe un correo con el formato tucorreo@ejemplo.com."
      />

      <div>
        <Campo
          etiqueta="Contraseña"
          name="password"
          type={mostrar ? "text" : "password"}
          autoComplete="current-password"
          enterKeyHint="done"
          required
          error="Escribe tu contraseña."
        />
        <button
          type="button"
          onClick={() => setMostrar((v) => !v)}
          aria-pressed={mostrar}
          className="mt-2 ml-1 text-xs font-medium text-[#C5A55A] underline-offset-4 hover:underline"
        >
          {mostrar ? "Ocultar contraseña" : "Mostrar contraseña"}
        </button>
      </div>

      <ErrorDeFormulario mensaje={errorServidor} />

      <button
        type="submit"
        disabled={pendiente}
        aria-busy={pendiente}
        className={botonPrimario}
      >
        {pendiente ? "Verificando" : "Iniciar sesión"}
      </button>

      <p className="text-center text-xs text-zinc-500">
        ¿Aún no tienes cuenta?{" "}
        <Link
          href="/registro"
          className="font-medium text-[#C5A55A] underline-offset-4 hover:underline"
        >
          Crea una
        </Link>
      </p>
    </form>
  );
}
