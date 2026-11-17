import { TEXTO_DEL_NIVEL, type PerfilCliente } from "@/lib/perfil-cliente";
import TarjetaDePerfil from "./TarjetaDePerfil";

/**
 * Nivel del cliente. Las reglas de los niveles aun no estan decididas, asi que
 * no se promete nada: ni beneficios, ni puntos, ni una barra de progreso hacia
 * un nivel que todavia no existe.
 */
export default function TarjetaNivel({ nivel }: { nivel: PerfilCliente["nivel"] }) {
  return (
    <TarjetaDePerfil id="perfil-nivel" titulo="Tu nivel">
      <p className="font-heading text-3xl font-semibold text-white">
        {nivel.nombre}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{TEXTO_DEL_NIVEL}</p>
    </TarjetaDePerfil>
  );
}
