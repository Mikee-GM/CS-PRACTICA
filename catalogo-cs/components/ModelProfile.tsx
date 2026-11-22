"use client";

import { useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import type { Modelo } from "@/types";
import FichaModelo, { estadoDeContacto } from "@/components/FichaModelo";
import { rutaDelPerfil } from "@/lib/posts";
import BotonChatear from "@/components/cliente/BotonChatear";
import { useModalAccesible } from "@/hooks/useModalAccesible";

interface ModelProfileProps {
  modelo: Modelo;
  onClose: () => void;
}

export default function ModelProfile({ modelo, onClose }: ModelProfileProps) {
  const allPhotos = [modelo.fotoPrincipal, ...modelo.fotos].filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  const tituloId = useId();
  const panel = useModalAccesible<HTMLDivElement>({ onCerrar: onClose });

  const { status, canContact } = estadoDeContacto(modelo);

  const goTo = (index: number) => {
    setActiveIndex(index);
  };

  const goPrev = () => {
    goTo(activeIndex === 0 ? allPhotos.length - 1 : activeIndex - 1);
  };

  const goNext = () => {
    goTo(activeIndex === allPhotos.length - 1 ? 0 : activeIndex + 1);
  };

  const minSwipeDistance = 40;
  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchStartX(e.targetTouches[0].clientX);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
  };
  const onTouchEnd = () => {
    if (!touchStartX || !touchEndX) return;
    const distance = touchStartX - touchEndX;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe && allPhotos.length > 1) {
      goNext();
    }
    if (isRightSwipe && allPhotos.length > 1) {
      goPrev();
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (allPhotos.length <= 1) return;
    if (Math.abs(e.deltaX) > 40) {
      if (e.deltaX > 0) goNext();
      else goPrev();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm overflow-y-auto p-4 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        transition={{
          duration: 0.35,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        }}
        // En desktop limitamos la altura y hacemos scroll, en movil dejamos fluir nativamente
        className="w-full max-w-4xl bg-[#050505] border border-zinc-800 shadow-2xl my-auto relative flex flex-col md:flex-row md:max-h-[85vh] overflow-hidden"
      >
        {/* Boton cerrar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 text-zinc-500 hover:text-white p-2 transition-colors bg-black/50 backdrop-blur-md border border-zinc-800 hover:border-[#C5A55A] rounded-full"
          aria-label="Cerrar"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Galeria de fotos con soporte tactil/scroll */}
        <div
          className="w-full md:w-1/2 flex-shrink-0 relative aspect-[3/4] md:aspect-auto bg-zinc-950 select-none cursor-grab active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={handleWheel}
        >
          {/* Mapeamos todas las fotos para pre-cargarlas en el DOM */}
          {allPhotos.map((url, i) => (
            <div
              key={url}
              className={`absolute inset-0 transition-opacity duration-700 ${
                i === activeIndex
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              <Image
                src={url}
                alt={`${modelo.nombre} - Foto ${i + 1}`}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
                priority={i === 0} // Precarga fuerte solo de la 1ra foto
              />
            </div>
          ))}

          {/* Navegacion de fotos */}
          {allPhotos.length > 1 && (
            <>
              <button
                onClick={goPrev}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-black/50 backdrop-blur-sm border border-zinc-700 text-white hover:border-[#C5A55A] hover:text-[#E8D5A3] transition-all rounded-full"
                aria-label="Foto anterior"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                onClick={goNext}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-black/50 backdrop-blur-sm border border-zinc-700 text-white hover:border-[#C5A55A] hover:text-[#E8D5A3] transition-all rounded-full"
                aria-label="Foto siguiente"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              {/* Indicadores inferiores */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
                {allPhotos.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === activeIndex
                        ? "bg-[#C5A55A] w-6"
                        : "bg-white/40 hover:bg-white/70 w-2"
                    }`}
                    aria-label={`Ver foto ${i + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Informacion de la modelo (Scrollable independiente en desktop) */}
        <div className="w-full md:w-1/2 p-6 sm:p-8 lg:p-10 flex flex-col overflow-y-auto customized-scrollbar">
          <div className="flex-1">
            {/* Nombre */}
            <h2 id={tituloId} className="font-heading text-3xl sm:text-4xl font-semibold text-white tracking-wide mb-2 pr-10">
              {modelo.nombre}
            </h2>
            {modelo.slug ? (
              <Link
                href={rutaDelPerfil(modelo.slug)}
                className="mb-5 inline-flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#C5A55A] underline-offset-4 transition-colors hover:text-[#E8D5A3] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]"
              >
                Ver perfil
              </Link>
            ) : null}
            <FichaModelo modelo={modelo} />

            {/* Barra flotante inferior de contacto fija en móvil para que siempre esté visible */}
            <div className="sticky bottom-0 inset-x-0 z-40 mt-6 -mx-6 -mb-6 space-y-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-black/95 to-black/80 backdrop-blur-lg border-t border-zinc-800/80 sm:hidden">
              {/* El chat web es la unica via de contacto con la modelo. */}
              {canContact && (
                <BotonChatear employeeId={modelo._id} nombre={modelo.nombre} />
              )}
              {!canContact && (
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center justify-center border border-zinc-800 bg-zinc-950 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600 rounded-lg"
                >
                  {status}
                </button>
              )}
            </div>
          </div>

          {/* Links para escritorio / dentro del flujo en desktop */}
          <div className="space-y-3 mt-8 hidden sm:block">
            {canContact && (
              <BotonChatear employeeId={modelo._id} nombre={modelo.nombre} />
            )}

            {/* Link de X */}
            {modelo.linkX && (
              <a
                href={modelo.linkX}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full px-5 py-4 border border-zinc-800 hover:border-[#C5A55A]/40 bg-zinc-900/30 hover:bg-zinc-900/60 transition-all duration-300 group rounded-lg"
              >
                <svg
                  className="w-4 h-4 text-zinc-400 group-hover:text-[#E8D5A3] transition-colors flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span className="text-xs font-medium tracking-wide text-zinc-300 group-hover:text-[#E8D5A3] transition-colors">
                  Sigueme para mas contenido
                </span>
              </a>
            )}

            {!canContact && (
              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center justify-center border border-zinc-800 bg-zinc-950 px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600"
              >
                {status}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
