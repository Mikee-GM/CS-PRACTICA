import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AiProviderService } from '../ai/ai-provider.service';
import { Clientes } from '../clients/entities/client.entity';
import { BookingAiService } from './booking-ai.service';
import { LimiteDiarioDeIaError } from './booking.errors';

/*
 * El contador vive en una sola sentencia SQL, asi que aqui se prueba lo que el
 * servicio decide con su resultado. La sentencia en si no tiene prueba
 * automatica: un mock no ejecuta SQL y hay que comprobarla contra una base.
 */
function nuevoServicio(opciones: {
  filas?: unknown;
  fallo?: Error;
  limite?: number | string;
}) {
  const query = jest.fn();
  if (opciones.fallo) query.mockRejectedValue(opciones.fallo);
  else query.mockResolvedValue(opciones.filas ?? []);
  const ai = {
    generateChatResponse: jest.fn().mockResolvedValue('Hola mor'),
  };
  const config = {
    get: jest.fn().mockReturnValue(opciones.limite ?? 15),
  };
  const servicio = new BookingAiService(
    { query } as unknown as Repository<Clientes>,
    ai as unknown as AiProviderService,
    config as unknown as ConfigService,
  );
  Object.assign(servicio, { logger: { warn: jest.fn() } });
  return { servicio, query, ai };
}

/** Parametros con los que se llamo a la sentencia del contador. */
function parametros(query: jest.Mock): unknown[] {
  return (query.mock.calls[0] as [string, unknown[]])[1];
}

const historial = [
  { role: 'user' as const, parts: [{ text: 'hola' }] },
  { role: 'model' as const, parts: [{ text: 'hola guapo' }] },
];

describe('BookingAiService.callModel', () => {
  it('traduce el historial al formato del proveedor', async () => {
    const { servicio, ai } = nuevoServicio({});

    await expect(servicio.callModel('prompt', historial)).resolves.toBe(
      'Hola mor',
    );
    expect(ai.generateChatResponse).toHaveBeenCalledWith('prompt', [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola guapo' },
    ]);
  });

  it('sin cliente no cuenta nada', async () => {
    const { servicio, query } = nuevoServicio({});

    await servicio.callModel('prompt', historial);

    expect(query).not.toHaveBeenCalled();
  });

  it('cuenta la llamada del cliente con el limite configurado y la hora de Mexico', async () => {
    const { servicio, query } = nuevoServicio({
      filas: [{ llamadas: 3, existe: true }],
      limite: '20',
    });

    await servicio.callModel('prompt', historial, { clienteId: 'cli-1' });

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'cli-1',
      20,
      'America/Mexico_City',
    ]);
  });

  it('al agotar el limite lanza el error tipado y no llama al proveedor', async () => {
    const { servicio, ai } = nuevoServicio({
      filas: [{ llamadas: null, existe: true }],
      limite: 15,
    });

    const llamada = servicio.callModel('prompt', historial, {
      clienteId: 'cli-1',
    });

    await expect(llamada).rejects.toBeInstanceOf(LimiteDiarioDeIaError);
    await expect(llamada).rejects.toMatchObject({
      clienteId: 'cli-1',
      limite: 15,
    });
    expect(ai.generateChatResponse).not.toHaveBeenCalled();
  });

  /** Lo que usa Telegram: se cuenta, pero el limite no se pasa a la base. */
  it('sin aplicar el limite solo cuenta y nunca corta', async () => {
    const { servicio, query, ai } = nuevoServicio({
      filas: [{ llamadas: 40, existe: true }],
    });

    await servicio.callModel('prompt', historial, {
      clienteId: 'cli-1',
      aplicarLimiteDiario: false,
    });

    expect(parametros(query)[1]).toBeNull();
    expect(ai.generateChatResponse).toHaveBeenCalled();
  });

  it('un cliente que no existe no se cuenta ni se bloquea', async () => {
    const { servicio, ai } = nuevoServicio({
      filas: [{ llamadas: null, existe: false }],
    });

    await servicio.callModel('prompt', historial, { clienteId: 'cli-x' });

    expect(ai.generateChatResponse).toHaveBeenCalled();
  });

  it('si la base falla al contar, la conversacion sigue', async () => {
    const { servicio, ai } = nuevoServicio({ fallo: new Error('sin base') });

    await expect(
      servicio.callModel('prompt', historial, { clienteId: 'cli-1' }),
    ).resolves.toBe('Hola mor');
    expect(ai.generateChatResponse).toHaveBeenCalled();
  });

  it('con un limite mal configurado usa el de por defecto', async () => {
    const { servicio, query } = nuevoServicio({
      filas: [{ llamadas: 1, existe: true }],
      limite: 'abc',
    });

    await servicio.callModel('prompt', historial, { clienteId: 'cli-1' });

    expect(parametros(query)[1]).toBe(15);
  });
});
