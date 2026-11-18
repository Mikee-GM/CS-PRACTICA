import {
  antiguedadDeUbicacion,
  ubicacionEstaVieja,
} from "@/lib/ubicacion-fresca";

type Props = {
  ubicacionVieja?: boolean;
  ultimaUbicacionAt?: string | null;
};

/**
 * Insignia del estado de la posicion de un chofer. Una posicion vieja no sirve
 * para despachar, y el dorado oscuro la distingue sin confundirla con el
 * verde/rojo de la disponibilidad.
 */
export default function UbicacionBadge({
  ubicacionVieja,
  ultimaUbicacionAt,
}: Props) {
  const ahora = new Date();
  const vieja = ubicacionEstaVieja({ ubicacionVieja, ultimaUbicacionAt }, ahora);

  if (vieja) {
    return (
      <span className="inline-flex items-center rounded-full border border-[#8B7635]/60 bg-[#8B7635]/20 px-2.5 py-0.5 text-[10px] font-bold text-[#E8D5A3]">
        Ubicación vieja - {antiguedadDeUbicacion(ultimaUbicacionAt, ahora)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-[#C5A55A]/40 bg-black px-2.5 py-0.5 text-[10px] font-bold text-[#C5A55A]">
      Ubicación al día
    </span>
  );
}
