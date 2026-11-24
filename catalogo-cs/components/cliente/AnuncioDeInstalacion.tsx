import AnuncioDeInstalacionCliente from "@/components/cliente/AnuncioDeInstalacionCliente";
import { getCurrentUser } from "@/lib/auth";
import type { BeneficioDeInstalacion } from "@/lib/beneficios-del-cliente";
import { getBeneficioDeInstalacion } from "@/lib/data/beneficios";
import { optionalSource } from "@/lib/optional-source";

/**
 * Anuncio de instalacion de la app para el cliente. Resuelve en el servidor si
 * aplica (sesion de cliente y estado del descuento) y deja al componente de
 * navegador solo lo que depende del dispositivo.
 */
export default async function AnuncioDeInstalacion() {
  const usuario = await getCurrentUser();
  if (!usuario || usuario.rol !== "cliente") return null;
  const beneficio = await optionalSource<BeneficioDeInstalacion | null>(
    getBeneficioDeInstalacion(),
    null,
    "descuento por instalar la app",
  );
  if (!beneficio) return null;
  return <AnuncioDeInstalacionCliente inicial={beneficio} />;
}
