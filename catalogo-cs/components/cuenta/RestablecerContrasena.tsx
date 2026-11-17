"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import DialogoConfirmacion from "@/components/ui/DialogoConfirmacion";
import { restablecerContrasenaAction } from "@/lib/actions/acceso-personal";
import { avisoDeContrasenaTemporal } from "@/lib/acceso-personal";
import { esRedireccion } from "@/lib/es-redireccion";

const CLASE_ENLACE =
  "inline-flex min-h-11 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:text-[#C5A55A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]";

/**
 * Restablecer la contraseña de alguien del personal con una temporal.
 *
 * Sin proveedor de correo no hay "olvide mi contraseña": la restablece un
 * admin (o el jefe, sobre las modelos de su equipo) y se la entrega a la
 * persona, que al entrar tiene que poner una propia.
 *
 * Dos pasos, los dos con `<dialog>` nativo abierto con `showModal()` (foco
 * contenido, Esc, fondo inerte y el foco de vuelta al boton que lo abrio):
 *
 * 1. Confirmacion, porque la accion cierra todas sus sesiones al instante.
 * 2. La temporal, que solo existe en este estado: el backend no guarda nada
 *    legible y aqui no se escribe en ningun sitio. Al cerrar el dialogo --con
 *    el boton, con Esc o con el gesto de atras-- se borra del estado, y no
 *    hay forma de volver a verla.
 */
export default function RestablecerContrasena({
  usuarioId,
  nombre,
  className = CLASE_ENLACE,
}: {
  /** Id del usuario, no el de la empleada o el chofer. */
  usuarioId: string;
  /** Para nombrar a la persona en la confirmacion y en las instrucciones. */
  nombre: string;
  className?: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState("");
  const [temporal, setTemporal] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function restablecer() {
    setError("");
    startTransition(async () => {
      try {
        const resultado = await restablecerContrasenaAction(usuarioId);
        if (resultado.success) {
          setConfirmando(false);
          setTemporal(resultado.passwordTemporal);
        } else {
          setError(resultado.error);
        }
      } catch (fallo) {
        if (esRedireccion(fallo)) throw fallo;
        setError("No se pudo restablecer la contraseña. Vuelve a intentarlo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setConfirmando(true);
        }}
        className={className}
      >
        <KeyRound size={13} aria-hidden="true" />
        Restablecer contraseña
      </button>

      <DialogoConfirmacion
        abierto={confirmando}
        titulo={`¿Restablecer la contraseña de ${nombre}?`}
        descripcion="Se generará una contraseña temporal que verás una sola vez. Su contraseña actual dejará de servir y se cerrarán todas sus sesiones abiertas; al entrar con la temporal deberá crear una nueva."
        etiquetaConfirmar="Restablecer"
        tono="rojo"
        ocupado={pendiente}
        error={error}
        onConfirmar={restablecer}
        onCerrar={() => setConfirmando(false)}
      />

      <DialogoTemporal
        temporal={temporal}
        nombre={nombre}
        onCerrar={() => setTemporal(null)}
      />
    </>
  );
}

/** La temporal recien emitida, con su boton de copiar. */
function DialogoTemporal({
  temporal,
  nombre,
  onCerrar,
}: {
  temporal: string | null;
  nombre: string;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const tituloId = `${id}-titulo`;
  const advertenciaId = `${id}-advertencia`;
  const aviso = avisoDeContrasenaTemporal(nombre);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (temporal && !dialogo.open) dialogo.showModal();
    if (!temporal && dialogo.open) dialogo.close();
  }, [temporal]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={tituloId}
      aria-describedby={advertenciaId}
      // Cualquier forma de cerrar (boton, Esc, gesto de atras) pasa por aqui y
      // borra la temporal del estado.
      onClose={() => {
        if (temporal) onCerrar();
      }}
      className="m-auto w-[min(100%-2rem,28rem)] overscroll-contain rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-0 text-white shadow-2xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      {temporal ? (
        <div className="space-y-4 p-6">
          <h2
            id={tituloId}
            className="font-heading text-2xl font-semibold leading-tight text-white"
          >
            {aviso.titulo}
          </h2>
          <p
            id={advertenciaId}
            className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs font-medium leading-relaxed text-amber-300"
          >
            {aviso.advertencia}
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-[#C5A55A]/40 bg-black px-4 py-3">
            <code
              className="min-w-0 flex-1 break-all font-mono text-lg font-bold tracking-[0.06em] text-[#E8D5A3] select-all"
            >
              {temporal}
            </code>
            <BotonCopiar texto={temporal} />
          </div>

          <p className="text-sm leading-relaxed text-zinc-400">
            {aviso.instrucciones}
          </p>

          <form method="dialog" className="flex justify-end">
            <button
              type="submit"
              className="min-h-11 rounded-xl border border-[#C5A55A]/70 px-5 text-xs font-semibold uppercase tracking-[0.14em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
            >
              Listo, cerrar
            </button>
          </form>
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Copia la temporal al portapapeles.
 *
 * La burbuja de confirmacion es a la vez lo que se ve y la region viva que
 * anuncia el lector de pantalla, y va fuera del boton: los hijos de un boton
 * son presentacionales y una region viva dentro no se anuncia bien. No se
 * deshabilita mientras se muestra el aviso: copiar es idempotente y
 * deshabilitarlo le quitaria el foco a quien usa el teclado.
 */
function BotonCopiar({ texto }: { texto: string }) {
  const [estado, setEstado] = useState<"" | "copiado" | "fallo">("");
  const [mensaje, setMensaje] = useState("");
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  async function copiar() {
    if (temporizador.current) clearTimeout(temporizador.current);
    let ok = true;
    try {
      // Solo existe en contexto seguro (https o localhost); si falta, lanza y
      // se cuenta como fallo: el valor sigue a la vista para copiarlo a mano.
      await navigator.clipboard.writeText(texto);
    } catch {
      ok = false;
    }
    setEstado(ok ? "copiado" : "fallo");
    // Se vacia y se vuelve a escribir para que un segundo intento con el mismo
    // texto tambien se anuncie.
    setMensaje("");
    requestAnimationFrame(() =>
      setMensaje(
        ok ? "Copiada" : "No se pudo copiar. Selecciónala y cópiala a mano.",
      ),
    );
    temporizador.current = setTimeout(() => {
      setEstado("");
      setMensaje("");
    }, 2500);
  }

  return (
    <span className="relative flex shrink-0 flex-col items-end">
      <button
        type="button"
        onClick={copiar}
        autoFocus
        aria-label="Copiar la contraseña temporal"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-zinc-700 text-[#C5A55A] transition-colors hover:border-[#C5A55A] hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
      >
        {estado === "copiado" ? (
          <Check size={18} aria-hidden="true" />
        ) : (
          <Copy size={18} aria-hidden="true" />
        )}
      </button>
      <span
        role="status"
        className={`absolute top-full right-0 z-10 mt-1 w-max max-w-[14rem] rounded-md border px-2 py-1 text-[11px] font-semibold transition-opacity motion-reduce:transition-none ${
          mensaje ? "opacity-100" : "opacity-0"
        } ${
          estado === "fallo"
            ? "border-red-900/50 bg-red-950/90 text-red-300"
            : "border-[#C5A55A]/40 bg-black text-[#E8D5A3]"
        }`}
      >
        {mensaje}
      </span>
    </span>
  );
}
