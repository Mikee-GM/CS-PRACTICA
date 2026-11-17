"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import DialogoConfirmacion from "@/components/ui/DialogoConfirmacion";
import {
  crearPublicacion,
  enviarPublicacionARevision,
  guardarTextoDePublicacion,
  quitarMediaDePublicacion,
  reordenarMediaDePublicacion,
  subirMediaDePublicacion,
} from "@/lib/actions/employee-posts";
import {
  accionesDisponibles,
  anuncioTrasMover,
  AVISO_EDITAR_PUBLICADA,
  avisoDelEditor,
  contadorDelTexto,
  cupoRestante,
  editarPideConfirmacion,
  etiquetaDeEstado,
  MAXIMO_DEL_TEXTO,
  motivoPendienteDeCorregir,
  moverEnLista,
  nombreDeMedia,
  revisarArchivo,
  traducirFallo,
  type PostDeLaModelo,
} from "@/lib/employee-posts";
import {
  ACEPTA_MEDIA,
  mediaOrdenada,
  REGLAS_DE_MEDIA,
  tipoDeMediaLocal,
  type MediaDelPost,
  type TipoDeMedia,
} from "@/lib/posts";
import MiniaturaDeMedia from "./MiniaturaDeMedia";
import { formularioDeMedia, prepararMedia, type MediaPreparada } from "./preparar-media";
import { CLASE_DEL_TONO } from "./TarjetaMiPublicacion";

/** Un archivo elegido que todavia no esta en el post. */
interface ArchivoEnCola {
  clave: string;
  nombre: string;
  original: File;
  kind: TipoDeMedia | null;
  /** URL de objeto para la vista previa: la foto o la portada del video. */
  vista: string | null;
  estado: "preparando" | "esperando" | "subiendo" | "error";
  mensaje?: string;
  /** Si reintentar puede servir (un corte de red si; un video largo no). */
  reintentable?: boolean;
  preparada?: MediaPreparada;
}

/** Lo que queda pendiente de confirmar en el dialogo. */
type Confirmacion =
  | { tipo: "editar-publicada"; continuar: () => void }
  | { tipo: "quitar"; media: MediaDelPost; indice: number }
  | { tipo: "enviar" };

const BOTON_DORADO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#C5A55A]/70 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#E8D5A3] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#E8D5A3]";

const BOTON_ICONO =
  "inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-300 transition-colors hover:border-[#C5A55A] hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:border-zinc-800 aria-disabled:hover:text-zinc-300";

let contadorDeClaves = 0;
function claveNueva() {
  contadorDeClaves += 1;
  return `local-${Date.now()}-${contadorDeClaves}`;
}

/**
 * Editor de una publicacion de la modelo: texto, fotos y videos, orden y envio
 * a revision.
 *
 * El borrador no se crea al abrir el editor sino al guardar el texto o subir el
 * primer archivo: abrir "Nueva publicacion" y volver atras no debe dejar un
 * borrador vacio en la lista.
 *
 * La media se sube de una en una, en serie. El cuerpo de una peticion no pasa
 * de 20 MB y un video puede llegar a eso; en serie, ademas, el cupo de diez
 * archivos y tres videos se comprueba contra lo que ya esta subido y un fallo
 * solo afecta a su archivo, que se queda en la cola con su motivo y su boton
 * de reintentar. Las Server Actions no informan del avance en bytes, asi que el
 * progreso es por archivo: cual se esta preparando, cual subiendo y cuantos van.
 *
 * Editar algo publicado lo saca del feed hasta que se apruebe de nuevo: eso se
 * confirma ANTES del primer cambio, no se descubre despues.
 */
export default function EditorDePublicacion({
  inicial,
  onCambio,
  onCerrar,
  onBorrar,
}: {
  /** `null` para una publicacion nueva. */
  inicial: PostDeLaModelo | null;
  /** Cada version nueva del post, para que la lista quede al dia. */
  onCambio: (post: PostDeLaModelo) => void;
  onCerrar: () => void;
  onBorrar: (post: PostDeLaModelo) => void;
}) {
  const [post, setPost] = useState<PostDeLaModelo | null>(inicial);
  const postRef = useRef(post);
  const [texto, setTexto] = useState(inicial?.caption ?? "");
  const [cola, setCola] = useState<ArchivoEnCola[]>([]);
  const colaRef = useRef<ArchivoEnCola[]>([]);
  const [tanda, setTanda] = useState({ total: 0, hechos: 0 });
  const [ocupado, setOcupado] = useState<"texto" | "orden" | null>(null);
  const [error, setError] = useState("");
  const [anuncio, setAnuncio] = useState("");
  const [confirmacion, setConfirmacionGuardada] = useState<Confirmacion | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  /*
   * El contenido y la apertura van por separado: el dialogo se queda montado
   * y conserva su texto mientras se cierra, y al no desmontarse el navegador
   * puede devolver el foco al boton que lo abrio.
   */
  const setConfirmacion = (nueva: Confirmacion) => {
    setConfirmacionGuardada(nueva);
    setDialogoAbierto(true);
  };
  const [dialogoOcupado, setDialogoOcupado] = useState(false);
  const [dialogoError, setDialogoError] = useState("");
  const selectorRef = useRef<HTMLInputElement>(null);
  const procesando = useRef(false);
  const textoId = useId();

  const aplicarPost = useCallback(
    (nuevo: PostDeLaModelo) => {
      postRef.current = nuevo;
      setPost(nuevo);
      onCambio(nuevo);
    },
    [onCambio],
  );

  const cambiarCola = useCallback((cambio: (actual: ArchivoEnCola[]) => ArchivoEnCola[]) => {
    colaRef.current = cambio(colaRef.current);
    setCola(colaRef.current);
  }, []);

  // Las vistas previas retienen el archivo en memoria hasta soltarlas.
  useEffect(
    () => () => {
      for (const item of colaRef.current) if (item.vista) URL.revokeObjectURL(item.vista);
    },
    [],
  );

  const status = post?.status ?? "borrador";
  const acciones = post ? accionesDisponibles(post) : null;
  const media = post ? mediaOrdenada(post.media) : [];
  const pendientes = cola.filter((i) => i.estado !== "error").length;
  const subiendo = pendientes > 0;
  const textoGuardado = post?.caption ?? "";
  const textoCambiado = texto.trim() !== textoGuardado.trim();
  const motivoAnterior = post ? motivoPendienteDeCorregir(post) : null;
  const aviso = avisoDelEditor(status);
  const etiqueta = post ? etiquetaDeEstado(post) : { texto: "Nueva", tono: "neutro" as const };

  // Al vaciarse la cola, la siguiente tanda vuelve a contar desde cero.
  useEffect(() => {
    if (cola.length === 0 && tanda.total > 0) setTanda({ total: 0, hechos: 0 });
  }, [cola.length, tanda.total]);

  /** Ejecuta `accion`, pidiendo antes confirmacion si el post esta publicado. */
  const comoEdicion = (accion: () => void) => {
    if (postRef.current && editarPideConfirmacion(postRef.current.status)) {
      setDialogoError("");
      setConfirmacion({ tipo: "editar-publicada", continuar: accion });
      return;
    }
    accion();
  };

  /** El post, creandolo como borrador si todavia no existe. */
  const asegurarPost = async (): Promise<
    { ok: true; post: PostDeLaModelo } | { ok: false; mensaje: string; reintentable: boolean }
  > => {
    if (postRef.current) return { ok: true, post: postRef.current };
    const creado = await crearPublicacion(texto.trim());
    if (!creado.ok) {
      return { ok: false, mensaje: creado.mensaje, reintentable: creado.status !== 400 };
    }
    aplicarPost(creado.datos);
    return { ok: true, post: creado.datos };
  };

  // -------------------------------------------------------------------------
  // Cola de subida
  // -------------------------------------------------------------------------

  const marcar = (clave: string, cambios: Partial<ArchivoEnCola>) =>
    cambiarCola((actual) => actual.map((i) => (i.clave === clave ? { ...i, ...cambios } : i)));

  const sacarDeLaCola = (clave: string) =>
    cambiarCola((actual) => {
      const item = actual.find((i) => i.clave === clave);
      if (item?.vista) URL.revokeObjectURL(item.vista);
      return actual.filter((i) => i.clave !== clave);
    });

  /** Prepara y sube, de uno en uno, lo que este en cola sin error. */
  const procesarCola = async () => {
    if (procesando.current) return;
    procesando.current = true;
    try {
      for (;;) {
        const item = colaRef.current.find(
          (i) => i.estado === "preparando" || i.estado === "esperando",
        );
        if (!item) break;
        await subirUno(item);
      }
    } finally {
      procesando.current = false;
    }
  };

  const subirUno = async (item: ArchivoEnCola) => {
    let preparada = item.preparada;
    if (!preparada) {
      try {
        preparada = await prepararMedia(item.original, {
          duracionMaximaMs: REGLAS_DE_MEDIA.maximaDuracionVideoMs,
        });
      } catch {
        marcar(item.clave, {
          estado: "error",
          reintentable: true,
          mensaje: `No se pudo abrir "${item.nombre}". Vuelve a guardarlo desde la galería del teléfono o prueba con otro archivo.`,
        });
        return;
      }
      if (preparada.portada && !item.vista) {
        marcar(item.clave, { vista: URL.createObjectURL(preparada.portada) });
      }
    }

    const revision = revisarArchivo(
      {
        nombre: item.nombre,
        tipo: item.original.type,
        bytes: preparada.archivo.size,
        duracionMs: preparada.durationMs,
        bytesPortada: preparada.portada?.size ?? 0,
      },
      cupoRestante(postRef.current?.media ?? []),
    );
    if (!revision.ok) {
      marcar(item.clave, { estado: "error", reintentable: false, mensaje: revision.mensaje, preparada });
      return;
    }
    if (revision.kind === "video" && !preparada.portada) {
      marcar(item.clave, {
        estado: "error",
        reintentable: true,
        preparada: undefined,
        mensaje: `No se pudo sacar la portada de "${item.nombre}". Vuelve a intentarlo o guárdalo de nuevo desde la galería.`,
      });
      return;
    }

    marcar(item.clave, { estado: "subiendo", preparada, mensaje: undefined });
    const destino = await asegurarPost();
    if (!destino.ok) {
      marcar(item.clave, { estado: "error", reintentable: destino.reintentable, mensaje: destino.mensaje });
      return;
    }

    let resultado: Awaited<ReturnType<typeof subirMediaDePublicacion>>;
    try {
      resultado = await subirMediaDePublicacion(destino.post.id, formularioDeMedia(preparada));
    } catch {
      /*
       * La accion ni siquiera respondio. Lo habitual es que el cuerpo pasara del
       * limite de Next (que corta antes de llegar al backend) o que se cayera la
       * red a mitad; los dos se cuentan como lo que la modelo puede corregir.
       */
      marcar(item.clave, {
        estado: "error",
        reintentable: true,
        mensaje: `No se pudo subir "${item.nombre}". Revisa tu conexión y reinténtalo; si es un video, recórtalo para que pese menos.`,
      });
      return;
    }

    if (!resultado.ok) {
      marcar(item.clave, {
        estado: "error",
        reintentable: resultado.status !== 400 && resultado.status !== 404 && resultado.status !== 413,
        mensaje: resultado.mensaje,
      });
      return;
    }
    aplicarPost(resultado.datos);
    sacarDeLaCola(item.clave);
    setTanda((t) => ({ ...t, hechos: t.hechos + 1 }));
    setAnuncio(`${revision.kind === "video" ? "Video subido" : "Foto subida"}: ${item.nombre}.`);
  };

  const elegirArchivos = (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    const nuevos: ArchivoEnCola[] = Array.from(lista).map((original) => {
      const kind = tipoDeMediaLocal(original.type);
      return {
        clave: claveNueva(),
        nombre: original.name || "archivo",
        original,
        kind,
        vista: kind === "imagen" ? URL.createObjectURL(original) : null,
        estado: "preparando",
      };
    });
    // Se limpia para que volver a elegir el mismo archivo dispare `change`.
    if (selectorRef.current) selectorRef.current.value = "";
    setError("");
    /*
     * En una publicacion visible se confirma aqui, despues de elegir y antes
     * de subir nada, y no antes de abrir el selector: con el dialogo modal
     * abierto el resto de la pagina es inerte, y abrir el selector desde el
     * boton del dialogo depende de una activacion que Safari no conserva.
     */
    comoEdicion(() => {
      cambiarCola((actual) => [...actual, ...nuevos]);
      setTanda((t) => ({ ...t, total: t.total + nuevos.length }));
      void procesarCola();
    });
  };

  const reintentar = (clave: string) => {
    marcar(clave, { estado: "esperando", mensaje: undefined });
    void procesarCola();
  };

  const descartar = (clave: string) => {
    sacarDeLaCola(clave);
    setTanda((t) => ({ ...t, total: Math.max(t.hechos, t.total - 1) }));
  };

  const abrirSelector = () => selectorRef.current?.click();

  // -------------------------------------------------------------------------
  // Texto, orden, quitar y enviar
  // -------------------------------------------------------------------------

  const guardarTexto = () =>
    comoEdicion(async () => {
      setError("");
      setOcupado("texto");
      try {
        if (!postRef.current) {
          const creado = await crearPublicacion(texto.trim());
          if (!creado.ok) return setError(creado.mensaje);
          aplicarPost(creado.datos);
        } else {
          const r = await guardarTextoDePublicacion(postRef.current.id, texto.trim());
          if (!r.ok) return setError(r.mensaje);
          aplicarPost(r.datos);
        }
        setAnuncio("Texto guardado.");
      } catch {
        setError(traducirFallo("guardar-texto", null));
      } finally {
        setOcupado(null);
      }
    });

  const mover = (indice: number, paso: -1 | 1) => {
    const actual = postRef.current;
    if (!actual || ocupado || subiendo) return;
    const ordenada = mediaOrdenada(actual.media);
    const nueva = moverEnLista(ordenada, indice, paso);
    if (!nueva) return;

    comoEdicion(async () => {
      setError("");
      setOcupado("orden");
      // Se pinta ya en su sitio: el boton que se pulso viaja con su miniatura
      // (misma clave) y conserva el foco.
      const optimista = { ...actual, media: nueva.map((m, i) => ({ ...m, position: i })) };
      postRef.current = optimista;
      setPost(optimista);
      setAnuncio(anuncioTrasMover(ordenada[indice].kind, indice + paso, nueva.length));
      try {
        const r = await reordenarMediaDePublicacion(
          actual.id,
          nueva.map((m) => m.id),
        );
        if (r.ok) {
          aplicarPost(r.datos);
        } else {
          postRef.current = actual;
          setPost(actual);
          setError(r.mensaje);
        }
      } catch {
        postRef.current = actual;
        setPost(actual);
        setError(traducirFallo("reordenar", null));
      } finally {
        setOcupado(null);
      }
    });
  };

  const pedirQuitar = (m: MediaDelPost, indice: number) => {
    if (ocupado || subiendo) return;
    setDialogoError("");
    setConfirmacion({ tipo: "quitar", media: m, indice });
  };

  const pedirEnvio = () => {
    setDialogoError("");
    setConfirmacion({ tipo: "enviar" });
  };

  const confirmar = async () => {
    if (!confirmacion) return;
    if (confirmacion.tipo === "editar-publicada") {
      const continuar = confirmacion.continuar;
      setDialogoAbierto(false);
      continuar();
      return;
    }
    const actual = postRef.current;
    if (!actual) return;
    setDialogoOcupado(true);
    setDialogoError("");
    try {
      if (confirmacion.tipo === "quitar") {
        const r = await quitarMediaDePublicacion(actual.id, confirmacion.media.id);
        if (!r.ok) return setDialogoError(r.mensaje);
        aplicarPost(r.datos);
        setAnuncio(`${confirmacion.media.kind === "video" ? "Video quitado" : "Foto quitada"}.`);
      } else {
        // El texto sin guardar viaja antes: lo que se revisa es lo que se ve.
        if (textoCambiado) {
          const t = await guardarTextoDePublicacion(actual.id, texto.trim());
          if (!t.ok) return setDialogoError(t.mensaje);
          aplicarPost(t.datos);
        }
        const r = await enviarPublicacionARevision(actual.id);
        if (!r.ok) return setDialogoError(r.mensaje);
        aplicarPost(r.datos);
        setAnuncio("Publicación enviada a revisión.");
      }
      setDialogoAbierto(false);
    } catch {
      setDialogoError(
        traducirFallo(confirmacion.tipo === "quitar" ? "quitar-media" : "enviar", null),
      );
    } finally {
      setDialogoOcupado(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const publicada = status === "aprobado";
  const dialogo = (() => {
    if (!confirmacion) return null;
    if (confirmacion.tipo === "editar-publicada") {
      return {
        titulo: "Editar una publicación visible",
        descripcion: AVISO_EDITAR_PUBLICADA,
        etiqueta: "Editar de todos modos",
        tono: "dorado" as const,
      };
    }
    if (confirmacion.tipo === "quitar") {
      const nombre = nombreDeMedia(confirmacion.media.kind, confirmacion.indice, media.length);
      return {
        titulo: `Quitar ${nombre.toLowerCase()}`,
        descripcion: publicada
          ? `Se borrará de la publicación. ${AVISO_EDITAR_PUBLICADA}`
          : "Se borrará de la publicación. Si la necesitas otra vez, tendrás que volver a subirla.",
        etiqueta: "Quitar",
        tono: "rojo" as const,
      };
    }
    return {
      titulo: "Enviar a revisión",
      descripcion:
        "Coordinación la revisará antes de que aparezca en el feed. Mientras tanto puedes seguir editándola.",
      etiqueta: "Enviar",
      tono: "dorado" as const,
    };
  })();

  const cupo = cupoRestante(media);
  const enCola = cola.length;
  const sinCupo = cupo.medias - pendientes <= 0;

  return (
    <section aria-labelledby={`${textoId}-titulo`} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCerrar}
          disabled={subiendo}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-800 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-[#C5A55A] hover:text-[#E8D5A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60 disabled:opacity-40"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Mis publicaciones
        </button>
        <p
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${CLASE_DEL_TONO[etiqueta.tono]}`}
        >
          {etiqueta.texto}
        </p>
      </div>

      <h2 id={`${textoId}-titulo`} className="font-heading text-3xl font-semibold text-white">
        {post ? "Editar publicación" : "Nueva publicación"}
      </h2>

      {aviso ? (
        <p
          className={`flex gap-2 rounded-xl border p-3 text-xs leading-relaxed ${
            publicada
              ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-100"
              : "border-zinc-800 bg-[#0A0A0A] text-zinc-400"
          }`}
        >
          {publicada ? (
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          ) : null}
          <span>{aviso}</span>
        </p>
      ) : null}

      {post?.status === "rechazado" && post.rejectionReason ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3 text-xs leading-relaxed text-red-200">
          {`Motivo del rechazo: ${post.rejectionReason}`}
        </p>
      ) : null}
      {motivoAnterior ? (
        <p className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-3 text-xs leading-relaxed text-red-200">
          {`Motivo del rechazo anterior: ${motivoAnterior}`}
        </p>
      ) : null}

      {/* Texto */}
      <div className="space-y-2 rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-4">
        <label htmlFor={textoId} className="block text-sm font-semibold text-white">
          Texto
        </label>
        <textarea
          id={textoId}
          rows={4}
          maxLength={MAXIMO_DEL_TEXTO}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-describedby={`${textoId}-ayuda`}
          placeholder="Opcional. Lo que quieras contar con tus fotos."
          className="w-full resize-y rounded-xl border border-zinc-800 bg-black p-3 text-base text-white outline-none placeholder:text-zinc-600 focus:border-[#C5A55A] sm:text-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={`${textoId}-ayuda`} className="text-[11px] tabular-nums text-zinc-500">
            {contadorDelTexto(texto)}
          </p>
          <button
            type="button"
            onClick={guardarTexto}
            disabled={!textoCambiado || ocupado !== null}
            aria-busy={ocupado === "texto"}
            className={BOTON_DORADO}
          >
            {ocupado === "texto" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            {ocupado === "texto" ? "Guardando" : "Guardar texto"}
          </button>
        </div>
      </div>

      {/* Fotos y videos */}
      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Fotos y videos</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            {`Hasta ${REGLAS_DE_MEDIA.maximoDeMedias} archivos y ${REGLAS_DE_MEDIA.maximoDeVideos} videos. Fotos JPEG, PNG o WEBP; videos MP4 o WebM de hasta ${REGLAS_DE_MEDIA.maximaDuracionVideoMs / 1000} segundos y 20 MB. El primero es la portada de la publicación.`}
          </p>
        </div>

        {media.length > 0 ? (
          <ol className="space-y-2" aria-label="Orden de las fotos y videos">
            {media.map((m, i) => {
              const nombre = nombreDeMedia(m.kind, i, media.length);
              const bloqueado = ocupado !== null || subiendo;
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-black p-2"
                >
                  <div className="w-16 shrink-0">
                    <MiniaturaDeMedia media={m} etiqueta={nombre} sizes="64px" />
                  </div>
                  <p className="min-w-0 flex-1 text-xs font-semibold text-zinc-300">{nombre}</p>
                  {/*
                    Sin `disabled`: un boton deshabilitado con el foco encima lo
                    pierde, y al llegar arriba del todo la persona se quedaria
                    sin saber donde esta. `aria-disabled` lo anuncia y el clic
                    se ignora.
                  */}
                  <button
                    type="button"
                    onClick={() => mover(i, -1)}
                    aria-disabled={i === 0 || bloqueado}
                    aria-label={`Subir ${nombre.toLowerCase()}`}
                    className={BOTON_ICONO}
                  >
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(i, 1)}
                    aria-disabled={i === media.length - 1 || bloqueado}
                    aria-label={`Bajar ${nombre.toLowerCase()}`}
                    className={BOTON_ICONO}
                  >
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => pedirQuitar(m, i)}
                    aria-disabled={bloqueado}
                    aria-label={`Quitar ${nombre.toLowerCase()}`}
                    className={`${BOTON_ICONO} hover:border-red-500/60 hover:text-red-300`}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ol>
        ) : enCola === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500">
            Todavía no hay fotos ni videos. Añade al menos uno para poder enviarla a revisión.
          </p>
        ) : null}

        {enCola > 0 ? (
          <div className="space-y-2">
            {subiendo ? (
              <div className="space-y-1">
                <label htmlFor={`${textoId}-progreso`} className="block text-xs text-zinc-400">
                  {`Subidos ${tanda.hechos} de ${tanda.total}`}
                </label>
                <progress
                  id={`${textoId}-progreso`}
                  value={tanda.hechos}
                  max={Math.max(1, tanda.total)}
                  className="h-2 w-full accent-[#C5A55A]"
                />
              </div>
            ) : null}
            <ul className="space-y-2" aria-label="Archivos por subir">
              {cola.map((item) => (
                <li
                  key={item.clave}
                  className={`flex items-start gap-3 rounded-xl border p-2 ${
                    item.estado === "error" ? "border-red-500/30 bg-red-500/[0.05]" : "border-zinc-800 bg-black"
                  }`}
                >
                  <div className="relative aspect-square w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                    {item.vista ? (
                      // Vista previa local con URL de objeto: el archivo aun no
                      // existe en el servidor, next/image no tiene que optimizar.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.vista} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-xs font-semibold text-zinc-200" title={item.nombre}>
                      {item.nombre}
                    </p>
                    {item.estado === "error" ? (
                      <p className="text-xs leading-relaxed text-red-300">{item.mensaje}</p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                        {item.estado === "esperando" ? null : (
                          <Loader2
                            aria-hidden="true"
                            className="h-3.5 w-3.5 animate-spin text-[#C5A55A] motion-reduce:animate-none"
                          />
                        )}
                        {item.estado === "preparando"
                          ? item.kind === "video"
                            ? "Revisando el video"
                            : "Preparando la foto"
                          : item.estado === "subiendo"
                            ? "Subiendo"
                            : "En espera"}
                      </p>
                    )}
                    {item.estado === "error" ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {item.reintentable ? (
                          <button
                            type="button"
                            onClick={() => reintentar(item.clave)}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[#C5A55A]/60 px-3 text-xs font-semibold text-[#E8D5A3] transition-colors hover:bg-[#C5A55A] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
                          >
                            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                            Reintentar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => descartar(item.clave)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-800 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A55A]/60"
                        >
                          <X aria-hidden="true" className="h-3.5 w-3.5" />
                          Descartar
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <input
          ref={selectorRef}
          type="file"
          accept={ACEPTA_MEDIA}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => elegirArchivos(e.target.files)}
        />
        <button
          type="button"
          onClick={abrirSelector}
          disabled={sinCupo || ocupado !== null}
          className={`${BOTON_DORADO} w-full`}
        >
          <ImagePlus aria-hidden="true" className="h-4 w-4" />
          {sinCupo ? "Ya no caben más archivos" : "Añadir fotos o videos"}
        </button>
      </div>

      {/* Mensajes: el error se anuncia en cuanto aparece; lo demas, cortes. */}
      <p role="alert" className="min-h-5 text-sm text-red-400">
        {error}
      </p>
      <p role="status" className="sr-only">
        {anuncio}
      </p>

      {/* Envio y borrado */}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        {post && (status === "borrador" || status === "rechazado") ? (
          <button
            type="button"
            onClick={pedirEnvio}
            disabled={!acciones?.enviar || subiendo || ocupado !== null}
            className={`${BOTON_DORADO} sm:flex-1`}
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            Enviar a revisión
          </button>
        ) : null}
        {post && acciones?.borrar ? (
          <button
            type="button"
            onClick={() => onBorrar(post)}
            disabled={subiendo || ocupado !== null}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-800 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-red-500/60 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:opacity-40"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            {acciones.borrar === "archivar" ? "Archivar" : "Eliminar"}
          </button>
        ) : null}
      </div>
      {post && (status === "borrador" || status === "rechazado") && media.length === 0 ? (
        <p className="text-xs text-zinc-500">Para enviarla a revisión necesita al menos una foto o un video.</p>
      ) : null}

      {dialogo ? (
        <DialogoConfirmacion
          abierto={dialogoAbierto}
          titulo={dialogo.titulo}
          descripcion={dialogo.descripcion}
          etiquetaConfirmar={dialogo.etiqueta}
          tono={dialogo.tono}
          ocupado={dialogoOcupado}
          error={dialogoError}
          onConfirmar={() => void confirmar()}
          onCerrar={() => {
            if (!dialogoOcupado) setDialogoAbierto(false);
          }}
        />
      ) : null}
    </section>
  );
}
