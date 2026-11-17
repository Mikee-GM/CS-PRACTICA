"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { abrirChatAction } from "@/lib/actions/conversaciones";
import { esRedireccion } from "@/lib/es-redireccion";
import { botonPrimario, ErrorDeFormulario } from "./Campo";

/**
 * Abre el chat web con una modelo.
 *
 * El catalogo es publico y estatico, asi que no sabe si hay sesion: lo
 * pregunta la accion al tocar. Sin sesion se va al login con el regreso a
 * `/chats?modelo=...`, que ofrece abrir este mismo chat; no se abre solo al
 * volver porque crear una conversacion es una escritura y no debe dispararse
 * por cargar una pagina.
 */
export default function BotonChatear({
  employeeId,
  nombre,
}: {
  employeeId: string;
  nombre: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();

  function abrir() {
    setError("");
    startTransition(async () => {
      try {
        // Si sale bien, la accion navega al chat y no vuelve.
        const resultado = await abrirChatAction(employeeId);
        if (resultado.success) return;
        if (resultado.requiereSesion) {
          const regreso = `/chats?modelo=${employeeId}`;
          router.push(`/ingresar?siguiente=${encodeURIComponent(regreso)}`);
          return;
        }
        setError(resultado.error);
      } catch (e) {
        if (esRedireccion(e)) throw e;
        setError("No se pudo abrir el chat. Revisa tu conexión y vuelve a intentarlo.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={abrir}
        disabled={pendiente}
        aria-busy={pendiente}
        className={botonPrimario}
      >
        <MessageCircle aria-hidden="true" className="h-4 w-4" />
        {pendiente ? "Abriendo chat" : `Chatear con ${nombre}`}
      </button>
      <ErrorDeFormulario mensaje={error} />
    </div>
  );
}
