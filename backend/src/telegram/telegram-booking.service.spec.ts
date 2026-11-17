import { TelegramBookingService } from './telegram-booking.service';

/*
 * La llamada a la IA de Telegram delega en `BookingAiService`. Lo que hay que
 * sostener es que Telegram no cambia: se resuelve el cliente por su chat, se
 * cuenta la llamada y nunca se le aplica el limite diario.
 */
function nuevoServicio(findOne: jest.Mock) {
  const bookingAi = { callModel: jest.fn().mockResolvedValue('Hola mor') };
  const servicio = Object.create(
    TelegramBookingService.prototype,
  ) as TelegramBookingService;
  Object.assign(servicio, {
    clientesRepository: { findOne },
    bookingAiService: bookingAi,
    logger: { warn: jest.fn() },
  });
  return { servicio, bookingAi };
}

const historial = [{ role: 'user' as const, parts: [{ text: 'hola' }] }];

describe('TelegramBookingService.getGroqResponse', () => {
  it('cuenta la llamada al cliente del chat, sin limite diario', async () => {
    const findOne = jest.fn().mockResolvedValue({ id: 'cli-1' });
    const { servicio, bookingAi } = nuevoServicio(findOne);

    await expect(
      servicio.getGroqResponse('prompt', historial, '555'),
    ).resolves.toBe('Hola mor');

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { telegramChatId: '555' } }),
    );
    expect(bookingAi.callModel).toHaveBeenCalledWith('prompt', historial, {
      clienteId: 'cli-1',
      aplicarLimiteDiario: false,
    });
  });

  it('sin chat no busca cliente y llama igual', async () => {
    const findOne = jest.fn();
    const { servicio, bookingAi } = nuevoServicio(findOne);

    await servicio.getGroqResponse('prompt', historial);

    expect(findOne).not.toHaveBeenCalled();
    expect(bookingAi.callModel).toHaveBeenCalledWith('prompt', historial, {
      clienteId: undefined,
      aplicarLimiteDiario: false,
    });
  });

  it('si no se puede leer el cliente, la conversacion sigue', async () => {
    const findOne = jest.fn().mockRejectedValue(new Error('sin base'));
    const { servicio, bookingAi } = nuevoServicio(findOne);

    await expect(
      servicio.getGroqResponse('prompt', historial, '555'),
    ).resolves.toBe('Hola mor');
    expect(bookingAi.callModel).toHaveBeenCalled();
  });
});
