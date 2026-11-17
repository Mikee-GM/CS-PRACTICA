import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MisPublicaciones from "@/components/empleada/posts/MisPublicaciones";
import { getCurrentUser } from "@/lib/auth";
import { getMisPublicaciones } from "@/lib/data/employee-posts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mis publicaciones -- Mi Portal",
  robots: "noindex, nofollow",
};

/**
 * Publicaciones del feed de la modelo: crearlas, subir fotos y videos,
 * ordenarlos y mandarlas a revision.
 *
 * Exige sesion propia, como el historial: el enlace de un solo uso del bot ya
 * se canjea por cookie al abrir el portal, y sin cuenta no hay a nombre de
 * quien guardar un borrador.
 */
export default async function EmpleadaPostsPage() {
  const sesion = await getCurrentUser();
  if (!sesion) redirect("/ingresar");
  if (sesion.rol !== "empleada") redirect("/");

  const lectura = await getMisPublicaciones();

  return (
    <main className="min-h-dvh bg-[#050505] px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-zinc-100 sm:px-6">
      <div className="mx-auto max-w-xl">
        <MisPublicaciones lecturaInicial={lectura} />
      </div>
    </main>
  );
}
