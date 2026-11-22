"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { User, Lock, Mail, CheckCircle2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { updateMyProfileAction } from "@/lib/actions/auth";
import { useModalAccesible } from "@/hooks/useModalAccesible";

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: {
    nombre?: string | null;
    apellido?: string | null;
    email?: string | null;
  } | null;
  onProfileUpdated?: (updated: { nombre?: string | null; apellido?: string | null; email?: string | null }) => void;
}

export default function EditProfileModal({
  isOpen,
  onClose,
  currentUser,
  onProfileUpdated,
}: EditProfileModalProps) {
  const idsCampos = useId();
  const [nombre, setNombre] = useState(currentUser?.nombre || "");
  const [apellido, setApellido] = useState(currentUser?.apellido || "");
  const email = currentUser?.email || "";
  const [saving, setSaving] = useState(false);
  const tituloId = useId();
  const panel = useModalAccesible<HTMLDivElement>({
    activo: isOpen,
    bloqueado: saving,
    onCerrar: onClose,
  });

  if (!isOpen) return null;

  /*
   * Solo nombre y apellido. `PATCH /users/me` no acepta correo ni contraseña:
   * el correo es la identidad de la cuenta, y la contraseña se cambia en
   * Ajustes, pidiendo la actual. Antes esto mandaba una contraseña nueva sin
   * pedir la anterior a `PATCH /users/:id`.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setSaving(true);
    try {
      const res = await updateMyProfileAction({ nombre, apellido });

      if (res.success) {
        toast.success("Perfil actualizado con éxito");
        onProfileUpdated?.({ nombre, apellido, email });
        onClose();
      } else {
        toast.error(res.error || "Error al actualizar perfil");
      }
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar datos");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[#0c0c0c] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#C5A55A]/30 bg-[#C5A55A]/10 text-[#C5A55A]">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h3 id={tituloId} className="text-base font-bold text-white">Mi Perfil (Admin)</h3>
              <p className="text-xs text-zinc-400">Actualiza tu nombre y apellido</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${idsCampos}-c1`} className="text-zinc-300 font-semibold">Nombre</label>
              <div className="relative mt-1">
                <input id={`${idsCampos}-c1`} autoComplete="given-name"
                  type="text"
                  placeholder="Ej: Carlos"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-white placeholder:text-zinc-600 focus:border-[#C5A55A] focus:outline-none transition-colors"
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${idsCampos}-c2`} className="text-zinc-300 font-semibold">Apellido</label>
              <div className="relative mt-1">
                <input id={`${idsCampos}-c2`} autoComplete="family-name"
                  type="text"
                  placeholder="Ej: Gomez"
                  value={apellido}
                  onChange={(e) => setApellido(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-white placeholder:text-zinc-600 focus:border-[#C5A55A] focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor={`${idsCampos}-c3`} className="text-zinc-300 font-semibold">Correo Electrónico</label>
            <div className="relative mt-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
                <Mail className="h-4 w-4" />
              </div>
              <input id={`${idsCampos}-c3`} autoComplete="email"
                type="email"
                value={email}
                readOnly
                aria-describedby="perfil-correo-ayuda"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 pl-9 pr-3.5 py-2.5 text-zinc-400 focus:border-[#C5A55A] focus:outline-none transition-colors"
              />
            </div>
          </div>

          <p id="perfil-correo-ayuda" className="text-[11px] text-zinc-500">
            El correo es tu usuario de acceso y no se cambia desde aquí.
          </p>

          <div className="pt-3 border-t border-zinc-900">
            <Link
              href="/admin/ajustes"
              onClick={onClose}
              className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[#C5A55A] underline-offset-4 hover:underline"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              Cambiar contraseña en Ajustes
            </Link>
          </div>

          <div className="mt-6 flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              className="rounded-xl bg-[#C5A55A] px-5 py-2.5 text-xs font-bold text-black hover:bg-[#d8b86d] disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Guardar Cambios
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
