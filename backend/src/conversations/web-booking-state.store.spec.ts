import { ConflictoDeVersionError } from '../booking/booking.errors';
import { estadoInicial } from '../booking/booking-state';
import type { ConversationRef } from '../booking/chat-channel';
import { WebBookingStateStore } from './web-booking-state.store';

const REF: ConversationRef = {
  clienteId: 'cliente-1',
  empleadaId: 'empleada-1',
  bookingSessionId: null,
  channel: 'web',
  conversationId: 'conversacion-1',
};

describe('WebBookingStateStore', () => {
  let dataSource: { query: jest.Mock };
  let store: WebBookingStateStore;

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    store = new WebBookingStateStore(dataSource as any);
  });

  it('lee el estado y completa lo que falte con el estado inicial', async () => {
    dataSource.query.mockResolvedValueOnce([{ state: {}, state_version: 4 }]);

    const cargado = await store.load(REF);

    expect(cargado).toEqual({ state: estadoInicial(), version: 4 });
    expect(dataSource.query.mock.calls[0][1]).toEqual(['conversacion-1']);
  });

  it('devuelve null si la conversacion no existe', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await expect(store.load(REF)).resolves.toBeNull();
  });

  it('guarda comparando la version en la misma sentencia', async () => {
    dataSource.query.mockResolvedValueOnce([{ state_version: 5 }]);
    const estado = { ...estadoInicial(), duracionPactadaHoras: 2 };

    await expect(store.save(REF, estado, 4)).resolves.toEqual({ version: 5 });

    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('state_version = $3');
    expect(sql).toContain('state_version = state_version + 1');
    expect(params).toEqual(['conversacion-1', JSON.stringify(estado), 4]);
  });

  it('rechaza con ConflictoDeVersionError si otro guardo antes', async () => {
    dataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ state_version: 7 }]);

    const intento = store.save(REF, estadoInicial(), 4);

    await expect(intento).rejects.toBeInstanceOf(ConflictoDeVersionError);
    await expect(intento).rejects.toMatchObject({
      versionEsperada: 4,
      versionActual: 7,
    });
  });

  it('exige el id de la conversacion', async () => {
    await expect(
      store.load({ ...REF, conversationId: undefined }),
    ).rejects.toThrow('id de la conversacion');
  });
});
