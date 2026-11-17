import { Logger } from '@nestjs/common';
import {
  avisarAlChatWeb,
  textoAvisoCancelacionPorDemora,
  textoParaChatWeb,
  unaVez,
} from './aviso-al-cliente-web';

describe('textoParaChatWeb', () => {
  it('quita emojis y el Markdown de Telegram', () => {
    expect(
      textoParaChatWeb(
        '*Cuenta final del servicio*\n\nMándame una *FOTO* del comprobante \u{1F618}',
      ),
    ).toBe('Cuenta final del servicio\n\nMándame una FOTO del comprobante');
  });

  it('quita la cursiva con guiones bajos sin tocar los que no son formato', () => {
    expect(textoParaChatWeb('Te espero _abajo_, en mi_casa.')).toBe(
      'Te espero abajo, en mi_casa.',
    );
  });

  it('deja intacto un texto que ya era plano', () => {
    const texto = 'La extensión de 2 horas quedó registrada.';
    expect(textoParaChatWeb(texto)).toBe(texto);
  });
});

describe('textoAvisoCancelacionPorDemora', () => {
  it('no lleva emojis ni formato y remite al catalogo', () => {
    const texto = textoAvisoCancelacionPorDemora('Valentina');
    expect(texto).toContain('Valentina');
    expect(texto).toContain('catálogo');
    expect(texto).not.toMatch(/[*_`]/);
    expect(texto).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('unaVez', () => {
  it('redacta una sola vez aunque lo pidan dos canales', async () => {
    const producir = jest.fn().mockResolvedValue('Ya voy');
    const redactar = unaVez(producir);

    await expect(redactar()).resolves.toBe('Ya voy');
    await expect(redactar()).resolves.toBe('Ya voy');
    expect(producir).toHaveBeenCalledTimes(1);
  });
});

describe('avisarAlChatWeb', () => {
  const registrarError = jest.fn();
  const logger = { error: registrarError } as unknown as Logger;
  const notifier = { notifyClient: jest.fn().mockResolvedValue(true) };
  const servicioWeb = {
    id: 'svc-1',
    clienteId: 'cli-1',
    empleadaId: 'emp-1',
    cliente: { usuarioId: 'usr-1' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('sin cuenta web no redacta ni consulta nada', async () => {
    const redactar = jest.fn();
    const entregado = await avisarAlChatWeb(
      notifier as any,
      logger,
      { ...servicioWeb, cliente: { usuarioId: null } },
      redactar,
    );

    expect(entregado).toBe(false);
    expect(redactar).not.toHaveBeenCalled();
    expect(notifier.notifyClient).not.toHaveBeenCalled();
  });

  it('sin notificador no hace nada', async () => {
    await expect(
      avisarAlChatWeb(undefined, logger, servicioWeb, 'Hola'),
    ).resolves.toBe(false);
  });

  it('manda el texto limpio con el servicio y la modelo', async () => {
    await avisarAlChatWeb(
      notifier as any,
      logger,
      servicioWeb,
      'Ya llegué \u{1F618}',
    );

    expect(notifier.notifyClient).toHaveBeenCalledWith({
      clienteId: 'cli-1',
      serviceId: 'svc-1',
      employeeId: 'emp-1',
      texto: 'Ya llegué',
    });
  });

  it('no lanza si falla la redaccion', async () => {
    await expect(
      avisarAlChatWeb(notifier as any, logger, servicioWeb, () =>
        Promise.reject(new Error('sin IA')),
      ),
    ).resolves.toBe(false);
    expect(registrarError).toHaveBeenCalled();
  });
});
