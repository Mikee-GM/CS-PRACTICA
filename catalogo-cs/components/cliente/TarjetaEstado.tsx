import { textoDeEstado, type PerfilCliente } from "@/lib/perfil-cliente";
import TarjetaDePerfil from "./TarjetaDePerfil";

/**
 * Estado de la cuenta. Una restriccion no es un error del formulario: se marca
 * con el dorado oscuro y no con rojo, y se explica a quien acudir.
 */
export default function TarjetaEstado({
  estado,
}: {
  estado: PerfilCliente["estado"];
}) {
  const texto = textoDeEstado(estado);

  return (
    <TarjetaDePerfil
      id="perfil-estado"
      titulo="Estado de la cuenta"
      destacada={texto.restringida}
    >
      <p
        className={`font-heading text-xl font-semibold ${
          texto.restringida ? "text-[#E8D5A3]" : "text-white"
        }`}
      >
        {texto.titulo}
      </p>
      <p className="mt-1 text-sm text-zinc-400">{texto.detalle}</p>
    </TarjetaDePerfil>
  );
}
