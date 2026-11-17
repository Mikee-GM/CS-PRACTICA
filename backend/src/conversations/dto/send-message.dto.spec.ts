import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_MESSAGE_LENGTH, SendMessageDto } from './send-message.dto';

const CLIENT_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

async function errores(cuerpo: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(SendMessageDto, cuerpo);
  const resultado = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const propiedades: string[] = [];
  const recorrer = (lista: typeof resultado, prefijo = '') => {
    for (const error of lista) {
      const ruta = `${prefijo}${error.property}`;
      if (error.constraints) propiedades.push(ruta);
      recorrer(error.children ?? [], `${ruta}.`);
    }
  };
  recorrer(resultado);
  return propiedades;
}

describe('SendMessageDto', () => {
  it('acepta un mensaje de texto', async () => {
    await expect(
      errores({ body: 'hola', clientMessageId: CLIENT_MESSAGE_ID }),
    ).resolves.toEqual([]);
  });

  it('rechaza un mensaje sin texto ni ubicacion, o de solo espacios', async () => {
    await expect(
      errores({ clientMessageId: CLIENT_MESSAGE_ID }),
    ).resolves.toEqual(['body']);
    await expect(
      errores({ body: '   ', clientMessageId: CLIENT_MESSAGE_ID }),
    ).resolves.toEqual(['body']);
  });

  it('mantiene el tope de longitud', async () => {
    await expect(
      errores({
        body: 'a'.repeat(MAX_MESSAGE_LENGTH + 1),
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).resolves.toEqual(['body']);
  });

  it('con ubicacion el texto puede faltar o venir vacio', async () => {
    const location = { lat: 20.59, lng: -100.39, address: ' Centro ' };
    await expect(
      errores({ location, clientMessageId: CLIENT_MESSAGE_ID }),
    ).resolves.toEqual([]);
    await expect(
      errores({ body: '', location, clientMessageId: CLIENT_MESSAGE_ID }),
    ).resolves.toEqual([]);

    const dto = plainToInstance(SendMessageDto, {
      location,
      clientMessageId: CLIENT_MESSAGE_ID,
    });
    expect(dto.location?.address).toBe('Centro');
  });

  it('con ubicacion valida igual el texto que si viene', async () => {
    await expect(
      errores({
        body: 'a'.repeat(MAX_MESSAGE_LENGTH + 1),
        location: { lat: 20.59, lng: -100.39 },
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).resolves.toEqual(['body']);
  });

  it('rechaza coordenadas fuera de rango o campos de mas', async () => {
    await expect(
      errores({
        location: { lat: 91, lng: -100.39 },
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).resolves.toEqual(['location.lat']);
    await expect(
      errores({
        location: { lat: 20.59, lng: '-100' },
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).resolves.toEqual(['location.lng']);
    await expect(
      errores({
        location: { lat: 20.59, lng: -100.39, precision: 5 },
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    ).resolves.toEqual(['location.precision']);
  });
});
