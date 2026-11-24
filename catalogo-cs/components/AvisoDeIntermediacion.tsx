/**
 * Aviso de que la plataforma es solo un servicio de intermediacion.
 *
 * Un unico texto para todas las pantallas (catalogo, acceso, registro, chats):
 * si cambia la redaccion se cambia aqui y en ningun otro sitio.
 */
export const TEXTO_DE_INTERMEDIACION =
  "Esta plataforma es únicamente una aplicación de servicio y funciona solo como intermediaria entre clientes y modelos. No es una aplicación propia de las modelos ni presta por sí misma los servicios que se contratan.";

export default function AvisoDeIntermediacion({
  className = "",
}: {
  className?: string;
}) {
  return (
    <p
      className={`mx-auto max-w-md text-center text-[11px] leading-relaxed text-zinc-500 ${className}`}
    >
      {TEXTO_DE_INTERMEDIACION}
    </p>
  );
}
