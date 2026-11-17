import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { EVIDENCE_MAX_BYTES } from '../../upload/upload.service';

/** Tipos que se admiten para un comprobante, los mismos que guarda R2. */
export const TIPOS_DE_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Campos de texto del multipart de `POST /conversations/:id/receipt`. El
 * archivo va en el campo `file` y no pasa por aqui.
 */
export class UploadReceiptDto {
  @ApiPropertyOptional({
    description:
      'Uuid que genera el navegador; reenviar el mismo devuelve el mensaje ya guardado sin volver a subir la imagen',
  })
  @IsOptional()
  @IsUUID()
  readonly clientMessageId?: string;
}

/**
 * Opciones de Multer para el comprobante.
 *
 * El tope corta la subida mientras llega (Multer responde 413) en vez de
 * cargar en memoria lo que `UploadService.uploadEvidence` rechazaria despues.
 * El filtro solo mira el tipo declarado, para fallar pronto; el tipo real lo
 * decide `uploadEvidence` mirando los bytes.
 */
export const OPCIONES_DE_SUBIDA_DE_COMPROBANTE = {
  limits: { fileSize: EVIDENCE_MAX_BYTES, files: 1 },
  fileFilter: (
    _req: unknown,
    file: { mimetype?: string },
    callback: (error: Error | null, aceptar: boolean) => void,
  ): void => {
    if (TIPOS_DE_COMPROBANTE.includes((file.mimetype ?? '').toLowerCase())) {
      callback(null, true);
      return;
    }
    callback(
      new BadRequestException('Solo se aceptan imágenes JPEG, PNG o WEBP'),
      false,
    );
  },
};
