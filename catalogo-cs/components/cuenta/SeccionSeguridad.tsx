import FormCambioContrasena from "@/components/cuenta/FormCambioContrasena";

/**
 * Seccion "Seguridad" de los ajustes del personal: el cambio de contraseña con
 * la sesion abierta. La misma en los ajustes de la modelo, el chofer, el jefe
 * y el admin, para que el flujo no diverja de un rol a otro.
 *
 * Es un Server Component: solo reparte el correo, que el formulario necesita
 * para que el gestor de contraseñas sepa de que cuenta es la nueva.
 */
export default function SeccionSeguridad({ email }: { email: string }) {
  return (
    <section
      aria-labelledby="seccion-seguridad"
      className="rounded-2xl border border-zinc-800 bg-[#0A0A0A] p-5 sm:p-6"
    >
      <h2
        id="seccion-seguridad"
        className="font-heading text-2xl font-semibold text-white"
      >
        Seguridad
      </h2>
      <p className="mt-1.5 mb-5 text-sm leading-relaxed text-zinc-500">
        Cambia la contraseña con la que inicias sesión. Al hacerlo se cierran
        tus sesiones en los demás dispositivos.
      </p>
      <FormCambioContrasena email={email} />
    </section>
  );
}
