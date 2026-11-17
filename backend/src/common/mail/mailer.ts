export interface CorreoSaliente {
  para: string;
  asunto: string;
  texto: string;
}

/**
 * Puerto de salida de correo. El proveedor real (Resend, SES, SMTP) se elige
 * despues; mientras tanto la aplicacion depende solo de esta clase abstracta.
 */
export abstract class Mailer {
  abstract enviar(correo: CorreoSaliente): Promise<void>;
}
