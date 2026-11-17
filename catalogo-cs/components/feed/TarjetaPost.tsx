import Link from "next/link";
import { forwardRef, useId } from "react";

import AvatarModelo from "@/components/cliente/AvatarModelo";
import {
  fechaCompletaDelPost,
  fechaDelPost,
  mediaOrdenada,
  rutaDelPerfil,
  type PostDelFeed,
} from "@/lib/posts";
import BotonMeGusta from "./BotonMeGusta";
import CarruselMedia from "./CarruselMedia";

/**
 * Una publicacion del feed: quien la publico, cuando, su media, el me gusta y
 * el texto.
 *
 * El `article` acepta foco programatico (`tabIndex={-1}`) para que la lista
 * pueda llevar el foco a la primera publicacion recien cargada; no entra en el
 * orden de tabulacion.
 */
const TarjetaPost = forwardRef<
  HTMLElement,
  {
    post: PostDelFeed;
    /** Primera de la pantalla: su primera imagen se pide con prioridad. */
    prioridad: boolean;
    rutaDeRegreso: string;
    className?: string;
  }
>(function TarjetaPost({ post, prioridad, rutaDeRegreso, className }, ref) {
  const idTitulo = useId();
  const { employee } = post;
  const perfil = rutaDelPerfil(employee.slugCatalogo);
  const media = mediaOrdenada(post.media);

  return (
    <article
      ref={ref}
      tabIndex={-1}
      aria-labelledby={idTitulo}
      className={`overflow-hidden rounded-2xl border border-zinc-800/60 bg-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A] ${className ?? ""}`}
    >
      <header className="flex items-center gap-3 px-4 py-3">
        {/* Sin enlace propio: seria un segundo destino identico al del nombre. */}
        <AvatarModelo nombre={employee.nombreArtistico} fotoUrl={employee.fotoPerfilUrl} tamano={40} />
        <div className="min-w-0 flex-1">
          <h2 id={idTitulo} className="truncate font-heading text-lg font-semibold leading-tight text-white">
            <Link
              href={perfil}
              className="inline-flex min-h-6 items-center rounded-sm hover:text-[#E8D5A3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C5A55A]"
            >
              {employee.nombreArtistico}
            </Link>
          </h2>
          <time
            dateTime={post.publishedAt}
            title={fechaCompletaDelPost(post.publishedAt)}
            className="block text-[11px] text-zinc-500"
          >
            {fechaDelPost(post.publishedAt)}
          </time>
        </div>
      </header>

      {media.length > 0 ? (
        <CarruselMedia media={media} nombreModelo={employee.nombreArtistico} prioridad={prioridad} />
      ) : null}

      <div className="space-y-2 px-4 pb-4 pt-2">
        <BotonMeGusta
          postId={post.id}
          likedInicial={post.likedByMe}
          likeCountInicial={post.likeCount}
          rutaDeRegreso={rutaDeRegreso}
        />
        {post.caption ? (
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-zinc-300">
            {post.caption}
          </p>
        ) : null}
      </div>
    </article>
  );
});

export default TarjetaPost;
