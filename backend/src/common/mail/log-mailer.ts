import { Injectable, Logger } from '@nestjs/common';
import { CorreoSaliente, Mailer } from './mailer';

/**
 * Sustituto sin proveedor: deja el correo en el registro en vez de enviarlo.
 * Sirve para desarrollar el flujo de verificacion; en produccion hay que
 * registrar un `Mailer` real en `MailModule`.
 */
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger(LogMailer.name);

  enviar(correo: CorreoSaliente): Promise<void> {
    this.logger.warn(
      `Correo sin proveedor para ${correo.para}: ${correo.asunto}\n${correo.texto}`,
    );
    return Promise.resolve();
  }
}
