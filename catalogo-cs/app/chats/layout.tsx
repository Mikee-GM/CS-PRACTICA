import type { Metadata } from "next";

import AnuncioDeInstalacion from "@/components/cliente/AnuncioDeInstalacion";

/*
 * El area del cliente se ofrece como aplicacion instalable con su propio
 * manifiesto (el del panel apunta a /jefe). El anuncio de instalacion vive en el
 * layout y no en cada pagina para que no se vuelva a montar al cambiar de
 * pestana.
 */
export const metadata: Metadata = {
  manifest: "/manifest-cliente.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Colombia Sexys",
    statusBarStyle: "black-translucent",
  },
};

export default function ClienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AnuncioDeInstalacion />
    </>
  );
}
