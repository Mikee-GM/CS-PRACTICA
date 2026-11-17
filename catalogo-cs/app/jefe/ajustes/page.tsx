import SeccionSeguridad from "@/components/cuenta/SeccionSeguridad";
import PaginaDeAvisos from "@/components/ui/PaginaDeAvisos";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: "Avisos -- Panel de jefe",
  robots: "noindex, nofollow",
};

export default async function JefeAjustesPage() {
  // El middleware ya exige sesion de jefe; sin respuesta del backend se
  // pintan los avisos y se omite la seccion que necesita el correo.
  const usuario = await getCurrentUser();
  return (
    <PaginaDeAvisos volverA="/jefe" volverTexto="Mi equipo">
      {usuario ? <SeccionSeguridad email={usuario.email} /> : null}
    </PaginaDeAvisos>
  );
}
