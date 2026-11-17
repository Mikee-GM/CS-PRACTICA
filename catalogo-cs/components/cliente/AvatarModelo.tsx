import Image from "next/image";

/**
 * Foto circular de la modelo, con la inicial cuando no hay foto publicada.
 * La comparten la bandeja y la cabecera del chat.
 */
export default function AvatarModelo({
  nombre,
  fotoUrl,
  tamano = 48,
}: {
  nombre: string;
  fotoUrl: string | null;
  tamano?: number;
}) {
  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-full border border-[#C5A55A]/40 bg-zinc-900"
      style={{ width: tamano, height: tamano }}
    >
      {fotoUrl ? (
        <Image
          src={fotoUrl}
          // El nombre ya se lee al lado; repetirlo en la foto seria ruido.
          alt=""
          fill
          sizes={`${tamano}px`}
          className="object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center font-heading text-lg text-[#E8D5A3]"
        >
          {nombre.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
