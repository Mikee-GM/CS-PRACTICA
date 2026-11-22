"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/locale";

/**
 * Tarjeta generica para calificar lo que sigue pendiente de valorar.
 *
 * Calificar al cliente y calificar al chofer son el mismo gesto con otra
 * lista y otro endpoint; tenerlas como dos copias del formulario obligaba a
 * corregir cada detalle dos veces. La tarjeta desaparece sola cuando no queda
 * nada por calificar, que es lo normal: solo aparece los dias en que hay algo
 * que hacer.
 */

/** El backend exige comentario por debajo de tres estrellas. */
const ESTRELLAS_QUE_PIDEN_MOTIVO = 2;

export type PendienteDescrito = {
  /** Identificador estable del elemento dentro de la lista. */
  id: string;
  titulo: string;
  fecha?: string | null;
};

type Props<T> = {
  titulo: string;
  descripcion: string;
  icono: ReactNode;
  cargar: () => Promise<T[]>;
  calificar: (
    item: T,
    valoracion: { stars: number; comment: string },
  ) => Promise<{ success: boolean; error?: string }>;
  describir: (item: T) => PendienteDescrito;
};

export default function CalificarPendientes<T>({
  titulo,
  descripcion,
  icono,
  cargar,
  calificar,
  describir,
}: Props<T>) {
  const router = useRouter();
  const [pendientes, setPendientes] = useState<T[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [estrellas, setEstrellas] = useState(5);
  const [comentario, setComentario] = useState("");
  const [enviando, startTransition] = useTransition();

  const releer = useCallback(async () => {
    try {
      setPendientes(await cargar());
    } catch {
      // Sin lista no se dibuja nada; el resto del portal sigue funcionando.
      setPendientes([]);
    }
  }, [cargar]);

  useEffect(() => {
    void releer();
  }, [releer]);

  if (!pendientes || pendientes.length === 0) return null;

  function abrir(id: string) {
    setAbierto(id);
    setEstrellas(5);
    setComentario("");
  }

  function enviar(item: T) {
    if (estrellas <= ESTRELLAS_QUE_PIDEN_MOTIVO && !comentario.trim()) {
      toast.error("Con una o dos estrellas hace falta que cuentes qué pasó.");
      return;
    }
    startTransition(async () => {
      const resultado = await calificar(item, {
        stars: estrellas,
        comment: comentario,
      });
      if (!resultado.success) {
        toast.error(resultado.error ?? "No se pudo enviar la calificación.");
        return;
      }
      toast.success("Calificación enviada");
      setAbierto(null);
      await releer();
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-[#C5A55A]/40 bg-[#141721] p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        {icono}
        {titulo}
      </h3>
      <p className="text-[11px] leading-relaxed text-gray-400">{descripcion}</p>

      <div className="space-y-2">
        {pendientes.map((item) => {
          const { id, titulo: nombre, fecha } = describir(item);
          return (
            <div
              key={id}
              className="rounded-xl border border-white/5 bg-black/40 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">
                    {nombre}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {formatFecha(fecha) ?? "Servicio reciente"}
                  </p>
                </div>
                {abierto !== id && (
                  <button
                    type="button"
                    onClick={() => abrir(id)}
                    className="shrink-0 rounded-lg border border-[#C5A55A] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#E8D5A3] transition-colors hover:bg-[#C5A55A] hover:text-black"
                  >
                    Calificar
                  </button>
                )}
              </div>

              {abierto === id && (
                <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
                  <div className="flex items-center justify-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((valor) => (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => setEstrellas(valor)}
                        aria-label={`${valor} estrellas`}
                        className={`transition-colors ${
                          valor <= estrellas
                            ? "text-amber-300"
                            : "text-gray-600 hover:text-gray-400"
                        }`}
                      >
                        <Star
                          size={26}
                          fill={valor <= estrellas ? "currentColor" : "none"}
                        />
                      </button>
                    ))}
                  </div>

                  <textarea
                    aria-label="Comentario de la calificación"
                    value={comentario}
                    onChange={(evento) => setComentario(evento.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder={
                      estrellas <= ESTRELLAS_QUE_PIDEN_MOTIVO
                        ? "Cuenta qué pasó (obligatorio)"
                        : "Algo que quieras añadir (opcional)"
                    }
                    className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white outline-none placeholder:text-gray-600 focus:border-[#C5A55A]"
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAbierto(null)}
                      disabled={enviando}
                      className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
                    >
                      Ahora no
                    </button>
                    <button
                      type="button"
                      onClick={() => enviar(item)}
                      disabled={enviando}
                      aria-busy={enviando}
                      className="flex-1 rounded-lg border border-[#C5A55A] bg-[#C5A55A] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-[#E8D5A3] disabled:opacity-40"
                    >
                      {enviando ? "Enviando" : "Enviar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatFecha(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(APP_LOCALE, {
      timeZone: APP_TIME_ZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}
