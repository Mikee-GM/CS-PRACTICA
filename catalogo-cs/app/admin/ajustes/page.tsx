import SeccionSeguridad from "@/components/cuenta/SeccionSeguridad";
import PaginaDeAvisos from "@/components/ui/PaginaDeAvisos";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: "Aplicación y notificaciones -- Administración",
};

export default async function AdminSettingsPage() {
  // El middleware ya exige sesion de admin; sin respuesta del backend se
  // pintan los avisos y se omite la seccion que necesita el correo.
  const usuario = await getCurrentUser();
  return (
    <PaginaDeAvisos volverA="/admin/dashboard" volverTexto="Centro de mando">
      {usuario ? <SeccionSeguridad email={usuario.email} /> : null}
    </PaginaDeAvisos>
  );
}
