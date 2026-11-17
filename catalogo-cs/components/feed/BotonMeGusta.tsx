"use client";

import { Heart } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorDeFormulario } from "@/components/cliente/Campo";
import { pedirConSesion } from "@/lib/client-fetch";
import {
  accionPendiente,
  errorDelMeGusta,
  loginConRegreso,
  meGustaVisible,
  reconciliarMeGusta,
  textoDeMeGusta,
  type EstadoMeGusta,
} from "@/lib/posts";

/**
 * Me gusta de una publicacion, optimista.
 *
 * El corazon cambia al tocarlo y la peticion va detras. Mientras una peticion
 * esta en camino, los toques siguientes solo cambian el deseo; al volver, se
 * manda la que falte para llegar a el (o ninguna). Asi un doble toque no deja
 * un PUT y un DELETE cruzados cuyo orden de llegada decidiria el resultado.
 *
 * El nombre del boton es fijo ("Me gusta") y el estado va en `aria-pressed`:
 * repetirlo en el nombre haria que el lector dijera las dos cosas.
 */
export default function BotonMeGusta({
  postId,
  likedInicial,
  likeCountInicial,
  rutaDeRegreso,
}: {
  postId: string;
  likedInicial: boolean;
  likeCountInicial: number;
  /** A donde volver tras el login si la sesion termino. */
  rutaDeRegreso: string;
}) {
  const [confirmado, setConfirmado] = useState<EstadoMeGusta>({
    liked: likedInicial,
    likeCount: likeCountInicial,
  });
  const [deseado, setDeseado] = useState(likedInicial);
  const [error, setError] = useState("");

  // Los valores vivos para el bucle de envio, que corre fuera del render.
  const confirmadoRef = useRef(confirmado);
  const deseadoRef = useRef(deseado);
  const enviando = useRef(false);

  async function sincronizar() {
    if (enviando.current) return;
    enviando.current = true;
    try {
      let metodo = accionPendiente(confirmadoRef.current, deseadoRef.current);
      while (metodo) {
        let respuesta: Response;
        try {
          respuesta = await pedirConSesion(`/api/feed/posts/${encodeURIComponent(postId)}/like`, {
            method: metodo,
          });
        } catch {
          revertir(null);
          return;
        }
        if (respuesta.status === 401) {
          window.location.assign(loginConRegreso(rutaDeRegreso));
          return;
        }
        if (!respuesta.ok) {
          revertir(respuesta.status);
          return;
        }
        const datos: unknown = await respuesta.json().catch(() => null);
        // Con un cuerpo ilegible el cambio igual se aplico: se da por bueno el
        // calculo local hasta que el servidor diga otra cosa.
        const supuesto = meGustaVisible(confirmadoRef.current, metodo === "PUT");
        const nuevo = reconciliarMeGusta(supuesto, datos);
        confirmadoRef.current = nuevo;
        setConfirmado(nuevo);
        setError("");
        metodo = accionPendiente(nuevo, deseadoRef.current);
      }
    } finally {
      enviando.current = false;
    }
  }

  /** El deseo vuelve a lo ultimo confirmado; la pantalla se corrige sola. */
  function revertir(status: number | null) {
    deseadoRef.current = confirmadoRef.current.liked;
    setDeseado(confirmadoRef.current.liked);
    setError(errorDelMeGusta(status));
  }

  function alTocar() {
    const siguiente = !deseadoRef.current;
    deseadoRef.current = siguiente;
    setDeseado(siguiente);
    setError("");
    void sincronizar();
  }

  const visible = meGustaVisible(confirmado, deseado);

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <button
        type="button"
        onClick={alTocar}
        aria-pressed={visible.liked}
        aria-label="Me gusta"
        className="-ml-2.5 inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-[#E8D5A3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A] aria-pressed:text-[#D4AF37]"
      >
        <Heart
          aria-hidden="true"
          className="h-6 w-6 transition-transform motion-safe:active:scale-90"
          fill={visible.liked ? "currentColor" : "none"}
          strokeWidth={1.75}
        />
      </button>
      {/* Fuera del boton: si fuera parte de su nombre, el contador no se anunciaria al cambiar. */}
      <span aria-live="polite" className="text-sm font-medium tabular-nums text-zinc-300">
        {textoDeMeGusta(visible.likeCount)}
      </span>
      {error ? (
        <div className="w-full">
          <ErrorDeFormulario mensaje={error} />
        </div>
      ) : null}
    </div>
  );
}
