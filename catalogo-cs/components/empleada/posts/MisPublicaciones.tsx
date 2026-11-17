"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus } from "lucide-react";

import DialogoConfirmacion from "@/components/ui/DialogoConfirmacion";
import { borrarPublicacion, listarMisPublicaciones } from "@/lib/actions/employee-posts";
import type { LecturaDeMisPosts } from "@/lib/data/employee-posts";
import {
  avisoAlBorrar,
  conPostActualizado,
  mensajeTrasBorrar,
  traducirFallo,
  unirMisPosts,
  type PostDeLaModelo,
} from "@/lib/employee-posts";
import EditorDePublicacion from "./EditorDePublicacion";
import TarjetaMiPublicacion from "./TarjetaMiPublicacion";

const BOTON_DORADO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#C5A55A]/70 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#E8D5A3] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40";

/**
 * Pantalla de publicaciones de la modelo: la lista y, en su lugar, el editor.
 *
 * El editor sustituye a la lista en vez de abrirse en un dialogo: en el
 * telefono un formulario con fotos, cola de subida y botones de orden no cabe
 * en una capa, y el teclado la taparia. Al volver, la lista ya trae los
 * cambios porque el editor avisa de cada version nueva del post.
 */
export default function MisPublicaciones({
  lecturaInicial,
}: {
  lecturaInicial: LecturaDeMisPosts;
}) {
  const inicial = lecturaInicial.estado === "ok" ? lecturaInicial.pagina : null;
  const [posts, setPosts] = useState<PostDeLaModelo[]>(inicial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(inicial?.nextCursor ?? null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorLista, setErrorLista] = useState(
    lecturaInicial.estado === "error" ? lecturaInicial.mensaje : "",
  );
  const [aviso, setAviso] = useState("");

  /** `undefined`: lista; `null`: publicacion nueva; un post: editarlo. */
  const [editando, setEditando] = useState<PostDeLaModelo | null | undefined>(undefined);
  /** Clave del editor: una publicacion nueva arranca siempre en blanco. */
  const [claveEditor, setClaveEditor] = useState(0);

  const [porBorrar, setPorBorrar] = useState<PostDeLaModelo | null>(null);
  const [dialogoBorrar, setDialogoBorrar] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState("");

  const encabezadoRef = useRef<HTMLHeadingElement>(null);
  const volverAlaLista = useRef(false);

  // Al cambiar entre lista y editor la pantalla empieza arriba, y al volver a
  // la lista el foco va a su titulo para que el lector no se quede en el vacio.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (editando === undefined && volverAlaLista.current) {
      volverAlaLista.current = false;
      encabezadoRef.current?.focus();
    }
  }, [editando]);

  const alCambiarPost = useCallback((post: PostDeLaModelo) => {
    setPosts((actuales) => conPostActualizado(actuales, post));
  }, []);

  const abrirEditor = (post: PostDeLaModelo | null) => {
    setAviso("");
    setClaveEditor((c) => c + 1);
    setEditando(post);
  };

  const cerrarEditor = () => {
    volverAlaLista.current = true;
    setEditando(undefined);
  };

  const cargarMas = async () => {
    if (!cursor || cargandoMas) return;
    setCargandoMas(true);
    setErrorLista("");
    try {
      const r = await listarMisPublicaciones(cursor);
      if (!r.ok) {
        setErrorLista(r.mensaje);
        return;
      }
      setPosts((actuales) => unirMisPosts(actuales, r.datos.items));
      setCursor(r.datos.nextCursor);
    } catch {
      setErrorLista(traducirFallo("listar", null));
    } finally {
      setCargandoMas(false);
    }
  };

  const pedirBorrado = (post: PostDeLaModelo) => {
    setErrorBorrar("");
    setPorBorrar(post);
    setDialogoBorrar(true);
  };

  const confirmarBorrado = async () => {
    if (!porBorrar) return;
    setBorrando(true);
    setErrorBorrar("");
    try {
      const r = await borrarPublicacion(porBorrar.id);
      if (!r.ok) {
        setErrorBorrar(r.mensaje);
        return;
      }
      setPosts((actuales) => actuales.filter((p) => p.id !== porBorrar.id));
      setDialogoBorrar(false);
      setAviso(mensajeTrasBorrar(r.datos.resultado));
      if (editando !== undefined) cerrarEditor();
    } catch {
      setErrorBorrar(traducirFallo("borrar", null));
    } finally {
      setBorrando(false);
    }
  };

  const textoBorrar = porBorrar ? avisoAlBorrar(porBorrar.status) : null;

  return (
    <>
      {editando !== undefined ? (
        <EditorDePublicacion
          key={claveEditor}
          inicial={editando}
          onCambio={alCambiarPost}
          onCerrar={cerrarEditor}
          onBorrar={pedirBorrado}
        />
      ) : (
        <section aria-labelledby="mis-publicaciones-titulo" className="space-y-5">
          <Link
            href="/empleada/portal"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-800 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-[#C5A55A] hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Mi portal
          </Link>

          <div className="space-y-1">
            <h1
              id="mis-publicaciones-titulo"
              ref={encabezadoRef}
              tabIndex={-1}
              className="font-heading text-3xl font-semibold text-white outline-none"
            >
              Mis publicaciones
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              Fotos y videos para el feed de clientes. Cada publicación pasa por
              revisión de coordinación antes de verse.
            </p>
          </div>

          <button type="button" onClick={() => abrirEditor(null)} className={`${BOTON_DORADO} w-full`}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Nueva publicación
          </button>

          <p role="status" className="text-sm text-emerald-300">
            {aviso}
          </p>

          {posts.length === 0 && !errorLista ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-10 text-center">
              <p className="font-heading text-xl text-[#E8D5A3]">Todavía no has publicado nada</p>
              <p className="mt-1 text-sm text-zinc-500">
                Crea tu primera publicación con una o varias fotos o videos.
              </p>
            </div>
          ) : null}

          {posts.length > 0 ? (
            <ul className="space-y-4">
              {posts.map((post) => (
                <li key={post.id}>
                  <TarjetaMiPublicacion
                    post={post}
                    onEditar={() => abrirEditor(post)}
                    onBorrar={() => pedirBorrado(post)}
                  />
                </li>
              ))}
            </ul>
          ) : null}

          <p role="alert" className="text-sm text-red-400">
            {errorLista}
          </p>
          {/* Si ni la primera pagina llego, no hay cursor con el que reintentar. */}
          {lecturaInicial.estado === "error" && posts.length === 0 ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`${BOTON_DORADO} w-full`}
            >
              Volver a intentar
            </button>
          ) : null}

          {cursor ? (
            <button
              type="button"
              onClick={() => void cargarMas()}
              disabled={cargandoMas}
              aria-busy={cargandoMas}
              className={`${BOTON_DORADO} w-full`}
            >
              {cargandoMas ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : null}
              {cargandoMas ? "Cargando" : "Cargar más"}
            </button>
          ) : null}
        </section>
      )}

      <DialogoConfirmacion
        abierto={dialogoBorrar}
        titulo={textoBorrar?.titulo ?? "Borrar publicación"}
        descripcion={textoBorrar?.descripcion ?? ""}
        etiquetaConfirmar={textoBorrar?.etiquetaConfirmar ?? "Borrar"}
        tono="rojo"
        ocupado={borrando}
        error={errorBorrar}
        onConfirmar={() => void confirmarBorrado()}
        onCerrar={() => {
          if (!borrando) setDialogoBorrar(false);
        }}
      />
    </>
  );
}
