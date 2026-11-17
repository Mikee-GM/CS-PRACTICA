"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import NavegacionCliente from "@/components/cliente/NavegacionCliente";
import { publicacionesDelPerfilAction } from "@/lib/actions/posts";
import {
  loginConRegreso,
  registroConRegreso,
  rutaDelPerfil,
  type PublicacionesDelPerfil,
} from "@/lib/posts";
import AvisoDelFeed, {
  accionPrincipal,
  accionSecundaria,
  tituloDelAviso,
} from "./AvisoDelFeed";
import ListaPosts from "./ListaPosts";

type Estado =
  | { tipo: "cargando" }
  /** La accion no respondio: no se sabe ni si hay sesion. */
  | { tipo: "fallo" }
  | { tipo: "listo"; datos: PublicacionesDelPerfil };

const Contexto = createContext<{
  slug: string;
  estado: Estado;
  reintentar: () => void;
} | null>(null);

function useSesionDelPerfil() {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("Falta SesionDelPerfil alrededor del perfil");
  return valor;
}

/**
 * Quien mira el perfil de una modelo, resuelto en el navegador.
 *
 * El perfil se prerenderiza con la ficha publica (ISR, como el catalogo) y no
 * puede leer cookies sin volverse dinamico para todos. Por eso la parte que
 * depende de la sesion --la barra del cliente y las publicaciones-- se pide
 * despues de montar, en una sola Server Action, y se comparte por contexto: la
 * barra va arriba del todo y los posts al final, y las dos tienen que salir de
 * la misma respuesta.
 *
 * Los hijos pueden ser Server Components: la ficha sigue llegando en el HTML.
 */
export default function SesionDelPerfil({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    publicacionesDelPerfilAction(slug)
      .then((datos) => vigente && setEstado({ tipo: "listo", datos }))
      // La accion no redirige nunca (ver su comentario): cualquier rechazo es
      // de red o del servidor.
      .catch(() => vigente && setEstado({ tipo: "fallo" }));
    return () => {
      vigente = false;
    };
  }, [slug, intento]);

  const reintentar = useCallback(() => {
    setEstado({ tipo: "cargando" });
    setIntento((n) => n + 1);
  }, []);

  return (
    <Contexto.Provider value={{ slug, estado, reintentar }}>{children}</Contexto.Provider>
  );
}

/** La barra del area del cliente, solo si quien mira es un cliente. */
export function NavegacionDelPerfil() {
  const { estado } = useSesionDelPerfil();
  if (estado.tipo !== "listo" || estado.datos.sesion !== "cliente") return null;
  return <NavegacionCliente />;
}

/** Lo que va bajo la ficha: las publicaciones o lo que explica por que no se ven. */
export function PublicacionesDelPerfil({ nombre }: { nombre: string }) {
  const { slug, estado, reintentar } = useSesionDelPerfil();
  const regreso = rutaDelPerfil(slug);

  if (estado.tipo === "cargando") {
    return (
      // Reserva un alto parecido al de un aviso para que la pagina no salte al llegar.
      <p
        role="status"
        className="flex min-h-48 items-center justify-center rounded-2xl border border-zinc-900 text-xs uppercase tracking-[0.15em] text-zinc-600"
      >
        Cargando publicaciones
      </p>
    );
  }

  if (estado.tipo === "fallo") {
    return (
      <AvisoDelFeed
        titulo="Sin conexión"
        mensaje="No se pudieron cargar las publicaciones. Revisa tu conexión y vuelve a intentarlo.">
        <button type="button" onClick={reintentar} className={accionSecundaria}>
          Reintentar
        </button>
      </AvisoDelFeed>
    );
  }

  const { datos } = estado;

  if (datos.sesion === "ninguna") {
    return (
      <AvisoDelFeed
        titulo="Contenido exclusivo"
        mensaje={`Inicia sesión o crea una cuenta para ver las publicaciones de ${nombre}.`}
      >
        <Link href={loginConRegreso(regreso)} className={accionPrincipal}>
          Iniciar sesión
        </Link>
        <Link href={registroConRegreso(regreso)} className={accionSecundaria}>
          Crear cuenta
        </Link>
      </AvisoDelFeed>
    );
  }

  if (datos.sesion === "personal") {
    return (
      <AvisoDelFeed
        titulo="Solo para clientes"
        mensaje="Las publicaciones solo se muestran a las cuentas de cliente. Tu cuenta es del equipo."
      >
        <Link href={datos.inicio} className={accionSecundaria}>
          Ir a mi panel
        </Link>
      </AvisoDelFeed>
    );
  }

  const { lectura } = datos;
  if (lectura.estado === "sin-edad" || lectura.estado === "no-disponible") {
    return <AvisoDelFeed titulo={tituloDelAviso(lectura.estado)} mensaje={lectura.mensaje} />;
  }
  return (
    <ListaPosts
      slug={slug}
      paginaInicial={
        lectura.estado === "ok" ? lectura.pagina : { items: [], nextCursor: null }
      }
      errorInicial={lectura.estado === "error"}
    />
  );
}
