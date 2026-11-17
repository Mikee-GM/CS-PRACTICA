/**
 * Si una persona del equipo puede hacerse cargo de algo ahora.
 *
 * Son dos preguntas distintas y las dos tienen que cumplirse: `disponible` dice
 * que no esta ocupada en este momento, `enJornada` que sigue trabajando hoy.
 * Mirar solo la primera hacia que a alguien que ya cerro su dia le siguieran
 * cayendo servicios.
 *
 * Vive en su propio archivo para que quien solo necesita la regla (el alcance
 * del jefe en el chat web) no cargue todo `ServicesService`.
 */
export function puedeAtender(persona: {
  disponible?: boolean | null;
  enJornada?: boolean | null;
}): boolean {
  return persona.disponible !== false && persona.enJornada !== false;
}
