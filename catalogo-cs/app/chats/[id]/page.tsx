import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ErrorDeFormulario } from "@/components/cliente/Campo";
import VistaChat from "@/components/cliente/VistaChat";
import { getCurrentUser } from "@/lib/auth";
import type { PaginaDeMensajes, ResumenDeConversacion } from "@/lib/conversaciones";
import { getConversaciones, getMensajes } from "@/lib/data/conversaciones";
import { optionalSource } from "@/lib/optional-source";
import { inicioParaRol } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Chat | Colombia Sexys",
  robots: { index: false },
};

/*
 * Con el teclado abierto, Chrome en Android solo encoge el visor visual y la
 * barra de escritura (al pie de una columna `h-dvh`) quedaba debajo del
 * teclado. `resizes-content` encoge tambien el de diseño, asi que la columna
 * mide lo que queda visible y el boton de enviar sube con el teclado. Safari
 * ignora la clave y ya desplaza el campo enfocado a la vista. Se repite el
 * resto del viewport del layout porque esta declaracion lo sustituye.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  interactiveWidget: "resizes-content",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await getCurrentUser();
  if (!usuario) redirect(`/ingresar?siguiente=${encodeURIComponent(`/chats/${id}`)}`);
  if (usuario.rol !== "cliente") redirect(inicioParaRol(usuario.rol));
  if (!UUID.test(id)) notFound();

  /*
   * No hay `GET /conversations/:id`: la cabecera (modelo y estado) sale de la
   * bandeja, que ademas es la que dice si la conversacion es de este cliente.
   */
  const [conversaciones, pagina] = await Promise.all([
    optionalSource<ResumenDeConversacion[] | null>(getConversaciones(), null, "chat"),
    optionalSource<PaginaDeMensajes | null>(getMensajes(id), null, "chat (mensajes)"),
  ]);

  if (!conversaciones) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#050505] px-4">
        <div className="w-full max-w-md space-y-4">
          <ErrorDeFormulario mensaje="No se pudo cargar la conversación. Revisa tu conexión y recarga la página." />
          <Link
            href="/chats"
            className="inline-flex min-h-11 items-center text-xs font-medium text-[#C5A55A] underline-offset-4 hover:underline"
          >
            Volver a mis chats
          </Link>
        </div>
      </main>
    );
  }

  const conversacion = conversaciones.find((c) => c.id === id);
  if (!conversacion) notFound();

  return (
    <VistaChat
      // Otra conversacion es otro estado: sin la clave, React reusaria el de la anterior.
      key={conversacion.id}
      conversacion={conversacion}
      paginaInicial={pagina ?? { items: [], nextCursor: null }}
      errorInicial={pagina === null}
    />
  );
}
