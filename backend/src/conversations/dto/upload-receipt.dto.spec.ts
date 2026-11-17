import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EVIDENCE_MAX_BYTES } from '../../upload/upload.service';
import {
  OPCIONES_DE_SUBIDA_DE_COMPROBANTE,
  UploadReceiptDto,
} from './upload-receipt.dto';

describe('UploadReceiptDto', () => {
  it('admite el comprobante sin clientMessageId', async () => {
    const errores = await validate(plainToInstance(UploadReceiptDto, {}));
    expect(errores).toHaveLength(0);
  });

  it('rechaza un clientMessageId que no es uuid', async () => {
    const errores = await validate(
      plainToInstance(UploadReceiptDto, { clientMessageId: 'abc' }),
    );
    expect(errores).toHaveLength(1);
  });
});

describe('OPCIONES_DE_SUBIDA_DE_COMPROBANTE', () => {
  const filtrar = (mimetype?: string) =>
    new Promise<{ error: Error | null; aceptar: boolean }>((resolve) =>
      OPCIONES_DE_SUBIDA_DE_COMPROBANTE.fileFilter(
        {},
        { mimetype },
        (error, aceptar) => resolve({ error, aceptar }),
      ),
    );

  /** Multer corta la subida en el mismo tope que impone `uploadEvidence`. */
  it('limita el tamaño al de la evidencia y a un solo archivo', () => {
    expect(OPCIONES_DE_SUBIDA_DE_COMPROBANTE.limits).toEqual({
      fileSize: EVIDENCE_MAX_BYTES,
      files: 1,
    });
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'IMAGE/PNG'])(
    'acepta %s',
    async (mimetype) => {
      await expect(filtrar(mimetype)).resolves.toEqual({
        error: null,
        aceptar: true,
      });
    },
  );

  it.each(['application/pdf', 'image/gif', 'text/html', undefined])(
    'rechaza %s con 400',
    async (mimetype) => {
      const { error, aceptar } = await filtrar(mimetype);
      expect(aceptar).toBe(false);
      expect(error).toBeInstanceOf(BadRequestException);
    },
  );
});
