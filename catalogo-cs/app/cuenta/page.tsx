import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import AvisoCorreoPendiente from "@/components/cliente/AvisoCorreoPendiente";
import BotonReintentar from "@/components/cliente/BotonReintentar";
import { ErrorDeFormulario } from "@/components/cliente/Campo";
import FormContrasena from "@/components/cliente/FormContrasena";
import FormNombre from "@/components/cliente/FormNombre";
import NavegacionCliente from "@/components/cliente/NavegacionCliente";
import TarjetaCalificacion from "@/components/cliente/TarjetaCalificacion";
import TarjetaDePerfil from "@/components/cliente/TarjetaDePerfil";
import TarjetaEstado from "@/components/cliente/TarjetaEstado";
import TarjetaNivel from "@/components/cliente/TarjetaNivel";
import CerrarSesion from "@/components/ui/CerrarSesion";
import { getCurrentUser } from "@/lib/auth";
import { getPerfilCliente } from "@/lib/data/perfil-cliente";
import { optionalSource } from "@/lib/optional-source";
import {
  MENSAJE_PERFIL_NO_DISPONIBLE,
  textoDeServicios,
  textoMiembroDesde,
  type PerfilCliente,
} from "@/lib/perfil-cliente";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Mi perfil | Colombia Sexys",
  robots: { index: false },
};

const enlacePrimario =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#C5A55A] px-5 text-xs font-bold uppercase tracking-[0.15em] text-black transition-colors hover:bg-[#D4AF37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]";

const enlaceSecundario =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#C5A55A]/60 px-5 text-xs font-bold uppercase tracking-[0.15em] text-[#C5A55A] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]";

/**
 * Perfil del cliente: como lo ven las modelos (calificacion), su nivel, el
 * estado de la cuenta y los ajustes de nombre y contraseña.
 *
 * La ruta sigue siendo `/cuenta`: el middleware, los destinos del login y la
 * verificacion del correo ya llevan aqui. Si la lectura falla por la red la
 * pantalla se queda con un aviso y un reintento; una sesion caducada, en
 * cambio, la reemite `optionalSource` y manda al login.
 */
export default async function CuentaPage() {
  const usuario = await getCurrentUser();
  if (!usuario) redirect("/ingresar");
  // Cada rol tiene su sitio: el personal no tiene nada que hacer aqui.
  if (usuario.rol !== "cliente") redirect(inicioParaRol(usuario.rol));

  const perfil = await optionalSource<PerfilCliente | null>(
    getPerfilCliente(),
    null,
    "cuenta",
  );

  return (
    <>
      <NavegacionCliente />
      <main className="min-h-dvh bg-[#050505] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] md:pt-8">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C5A55A]/60">
                Mi perfil
              </p>
              <h1 className="mt-2 break-words font-heading text-3xl font-semibold text-white">
                {perfil?.nombre || "Bienvenido"}
              </h1>
              {perfil ? (
                <p className="mt-1 break-all text-sm text-zinc-500">
                  {perfil.email}
                </p>
              ) : null}
            </div>
            <CerrarSesion destino="/" />
          </header>

          {perfil ? <Perfil perfil={perfil} /> : <PerfilNoDisponible />}

          <div className="flex flex-wrap gap-3">
            <Link href="/chats" className={enlacePrimario}>
              Mis chats
            </Link>
            <Link href="/" className={enlaceSecundario}>
              Ver el catálogo
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function PerfilNoDisponible() {
  return (
    <div className="space-y-4">
      <ErrorDeFormulario mensaje={MENSAJE_PERFIL_NO_DISPONIBLE} />
      <BotonReintentar />
    </div>
  );
}

function Perfil({ perfil }: { perfil: PerfilCliente }) {
  const miembroDesde = textoMiembroDesde(perfil.miembroDesde);

  return (
    <>
      {perfil.correoVerificado ? null : (
        <AvisoCorreoPendiente email={perfil.email} />
      )}

      <TarjetaEstado estado={perfil.estado} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TarjetaCalificacion calificacion={perfil.calificacion} />
        <TarjetaNivel nivel={perfil.nivel} />
      </div>

      <TarjetaDePerfil id="perfil-actividad" titulo="Tu actividad">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Servicios</dt>
            <dd className="mt-1 text-sm font-medium text-white">
              {textoDeServicios(perfil.servicios)}
            </dd>
          </div>
          {miembroDesde ? (
            <div>
              <dt className="text-xs text-zinc-500">Miembro desde</dt>
              <dd className="mt-1 text-sm font-medium text-white">
                {miembroDesde}
              </dd>
            </div>
          ) : null}
        </dl>
      </TarjetaDePerfil>

      <TarjetaDePerfil id="perfil-nombre" titulo="Tu nombre">
        <FormNombre nombre={perfil.nombre} />
      </TarjetaDePerfil>

      <TarjetaDePerfil id="perfil-contrasena" titulo="Cambiar contraseña">
        <FormContrasena email={perfil.email} />
      </TarjetaDePerfil>
    </>
  );
}
