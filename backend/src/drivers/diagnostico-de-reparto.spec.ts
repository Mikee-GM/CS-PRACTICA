import type { Logger } from '@nestjs/common';

import { explicarFaltaDeChoferes } from './diagnostico-de-reparto';

/**
 * El diagnostico tiene que contar exactamente los mismos escalones que aplica
 * el reparto. Si cuenta uno que el reparto ya no exige --como el chat de
 * Telegram--, culpa de la lista vacia a algo que no tiene nada que ver.
 */
describe('El diagnostico de falta de choferes', () => {
  const conteoBase = {
    total: '3',
    activos: '3',
    en_jornada: '3',
    disponibles: '3',
    con_ubicacion: '3',
    con_ubicacion_reciente: '3',
    sin_sancion: '3',
    en_turno: '3',
    sin_ofertar: '0',
  };

  function preparar(conteo: Record<string, string>) {
    const db = { query: jest.fn().mockResolvedValue([conteo]) };
    // El doble se guarda aparte para no leer el metodo suelto del logger.
    const warn = jest.fn();
    const logger = { warn } as unknown as Logger;
    return { db, logger, warn };
  }

  it('ya no exige Telegram vinculado', async () => {
    const { db, logger, warn } = preparar(conteoBase);

    await explicarFaltaDeChoferes(db, logger);

    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toContain('telegram_chat_id');
    expect(warn.mock.calls[0][0]).not.toContain('Telegram');
  });

  it('cuenta aparte a los que tienen ubicacion pero vieja', async () => {
    const { db, logger, warn } = preparar(conteoBase);

    await explicarFaltaDeChoferes(db, logger);

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('AS con_ubicacion_reciente');
    expect(sql).toContain(
      "c.ultima_ubicacion_at >= now() - interval '15 minutes'",
    );
    expect(warn.mock.calls[0][0]).toContain(
      '3 con ubicacion de los ultimos 15 minutos',
    );
  });

  it('senala la ubicacion vieja cuando es ahi donde cae a cero', async () => {
    const { db, logger, warn } = preparar({
      ...conteoBase,
      con_ubicacion_reciente: '0',
      sin_sancion: '0',
      en_turno: '0',
    });

    await explicarFaltaDeChoferes(db, logger);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('de hace mas de 15 minutos'),
    );
  });

  it('no culpa a la ubicacion si hay alguna reciente', async () => {
    const { db, logger, warn } = preparar(conteoBase);

    await explicarFaltaDeChoferes(db, logger);

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('de hace mas de 15 minutos'),
    );
  });
});
