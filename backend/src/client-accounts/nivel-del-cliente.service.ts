import { Injectable } from '@nestjs/common';

export type EntradaDelNivel = {
  serviciosFinalizados: number;
  calificacion: number | null;
  miembroDesde: Date;
};

export type NivelDelCliente = {
  codigo: string;
  nombre: string;
};

/**
 * El nivel del cliente todavia no esta definido por el dueño: ni cuantos
 * niveles hay, ni sus nombres, ni que los hace subir. Mientras tanto todos los
 * clientes son `inicial`, y esta funcion es el unico lugar que debe cambiar
 * cuando se decida.
 *
 * No se usan `LoyaltyTier` ni `ClientMembership`: `awardForFinalizedService`
 * nunca se invoca en produccion, asi que esos datos no reflejan nada, y sus
 * nombres y umbrales prometen un programa que nadie ha aprobado.
 */
export function calcularNivel(entrada: EntradaDelNivel): NivelDelCliente {
  void entrada;
  return { codigo: 'inicial', nombre: 'Inicial' };
}

/** Envoltura inyectable para que el servicio de cuentas no dependa de la regla. */
@Injectable()
export class NivelDelClienteService {
  de(entrada: EntradaDelNivel): NivelDelCliente {
    return calcularNivel(entrada);
  }
}
