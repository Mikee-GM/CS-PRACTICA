"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { registroAction } from "@/lib/actions/cliente-auth";
import { esRedireccion } from "@/lib/es-redireccion";
import Campo, {
  botonPrimario,
  CasillaObligatoria,
  ErrorDeFormulario,
} from "./Campo";

// Una letra y un numero, de 8 a 72 caracteres: lo mismo que valida el backend
// (bcrypt solo lee los primeros 72 bytes). `pattern` exige coincidencia total.
const PATRON_CONTRASENA = "(?=.*[A-Za-z])(?=.*\\d).{8,72}";

export default function RegistroForm() {
  const [mostrar, setMostrar] = useState(false);
  const [errorServidor, setErrorServidor] = useState("");
  const [pendiente, startTransition] = useTransition();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    setErrorServidor("");

    startTransition(async () => {
      try {
        // Si el alta sale bien, la accion navega al area de cliente y no vuelve.
        const resultado = await registroAction({
          email: String(datos.get("email") ?? ""),
          password: String(datos.get("password") ?? ""),
          nombre: String(datos.get("nombre") ?? ""),
          mayorDeEdad: datos.get("mayorDeEdad") === "on",
          aceptaTerminos: datos.get("aceptaTerminos") === "on",
        });
        if (!resultado.success) setErrorServidor(resultado.error);
      } catch (error) {
        if (esRedireccion(error)) throw error;
        setErrorServidor("No se pudo crear la cuenta. Intenta de nuevo.");
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
        maxLength={255}
        placeholder="tucorreo@ejemplo.com"
        ayuda="Formato: tucorreo@ejemplo.com"
        error="Escribe un correo con el formato tucorreo@ejemplo.com."
      />

      <div>
        <Campo
          etiqueta="Contraseña"
          name="password"
          type={mostrar ? "text" : "password"}
          autoComplete="new-password"
          enterKeyHint="next"
          required
          minLength={8}
          maxLength={72}
          pattern={PATRON_CONTRASENA}
          ayuda="De 8 a 72 caracteres, con al menos una letra y un número."
          error="La contraseña no cumple los requisitos indicados arriba."
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

      <Campo
        etiqueta="Nombre (opcional)"
        name="nombre"
        type="text"
        autoComplete="name"
        enterKeyHint="done"
        maxLength={255}
        placeholder="Cómo quieres que te llamemos"
        error="Escribe un nombre de hasta 255 caracteres."
      />

      <div className="space-y-3 pt-1">
        <CasillaObligatoria
          name="mayorDeEdad"
          etiqueta="Declaro que soy mayor de 18 años."
          error="Debes ser mayor de 18 años para crear una cuenta."
        />
        <CasillaObligatoria
          name="aceptaTerminos"
          etiqueta="Acepto los términos y condiciones del servicio."
          error="Debes aceptar los términos y condiciones para continuar."
        />
      </div>

      <ErrorDeFormulario mensaje={errorServidor} />

      <button
        type="submit"
        disabled={pendiente}
        aria-busy={pendiente}
        className={botonPrimario}
      >
        {pendiente ? "Creando cuenta" : "Crear cuenta"}
      </button>

      <p className="text-center text-xs text-zinc-500">
        ¿Ya tienes cuenta?{" "}
        <Link
          href="/ingresar"
          className="font-medium text-[#C5A55A] underline-offset-4 hover:underline"
        >
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}
