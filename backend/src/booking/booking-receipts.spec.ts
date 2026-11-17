import {
  aplicarAnalisis,
  claveSpeiDe,
  comprobanteEnCurso,
  cuentasParaTransferir,
  enlazarComprobanteAServicio,
  estadoDeValidacion,
  marcarErrorDeValidacion,
  registrarValidacion,
  validateReceiptAnalysis,
} from './booking-receipts';

const CUENTA = {
  activa: true,
  banco: 'BBVA',
  titular: 'Omar Pérez',
  cuenta: '4152314214309919',
  ultimos4: '9919',
  clabe: '012180001234567891',
} as any;

describe('validateReceiptAnalysis', () => {
  const legible = {
    esComprobante: true,
    monto: '$1,250.00',
    cuentaDestino: '****9919',
    titularDestino: 'Omar Pérez',
  };

  it('da por buena la foto con monto y cuenta autorizada', () => {
    expect(validateReceiptAnalysis(legible, 1250, [CUENTA])).toEqual({
      valid: true,
      amount: 1250,
    });
  });

  /** Comparado en centavos: 1249.99 no alcanza 1250 por mucho redondeo. */
  it('rechaza un monto un centavo menor que el esperado', () => {
    const resultado = validateReceiptAnalysis(
      { ...legible, monto: '1249.99' },
      1250,
      [CUENTA],
    );
    expect(resultado.valid).toBe(false);
    expect(resultado.needsManualReview).toBeUndefined();
  });

  it('manda a revision si el analizador no respondio', () => {
    const resultado = validateReceiptAnalysis({ aiCallFailed: true }, 1250, [
      CUENTA,
    ]);
    expect(estadoDeValidacion(resultado)).toBe('PENDIENTE_REVISION');
  });

  it('rechaza lo que no es un comprobante', () => {
    const resultado = validateReceiptAnalysis({ esComprobante: false }, 1250, [
      CUENTA,
    ]);
    expect(estadoDeValidacion(resultado)).toBe('RECHAZADO');
  });
});

describe('comprobanteEnCurso', () => {
  const ahora = Date.parse('2026-11-16T20:00:00Z');
  const hace = (ms: number) => new Date(ahora - ms);
  const ventana = 3 * 60 * 1000;

  it('cuenta el analisis recien empezado', () => {
    expect(
      comprobanteEnCurso(
        { estado: 'PROCESANDO', createdAt: hace(5_000) },
        ventana,
        ahora,
      ),
    ).toBe(true);
  });

  it('no cuenta un analisis que se quedo colgado', () => {
    expect(
      comprobanteEnCurso(
        { estado: 'PROCESANDO', createdAt: hace(10 * 60_000) },
        ventana,
        ahora,
      ),
    ).toBe(false);
  });

  it.each(['PENDIENTE_REVISION', 'APROBADO'])(
    'cuenta el que esta en %s aunque sea viejo',
    (estado) => {
      expect(
        comprobanteEnCurso(
          { estado, createdAt: hace(24 * 3_600_000) },
          ventana,
          ahora,
        ),
      ).toBe(true);
    },
  );

  it.each(['RECHAZADO', 'ERROR_VALIDACION'])(
    'admite otro tras %s',
    (estado) => {
      expect(
        comprobanteEnCurso({ estado, createdAt: hace(1_000) }, ventana, ahora),
      ).toBe(false);
    },
  );

  it('sin validacion previa no hay nada en curso', () => {
    expect(comprobanteEnCurso(null, ventana, ahora)).toBe(false);
  });
});

describe('registro y resultado de la validacion', () => {
  const repositorio = {
    create: jest.fn((valor: object) => valor),
    save: jest.fn((valor: object) =>
      Promise.resolve({ id: 'validacion-1', ...valor }),
    ),
  };

  beforeEach(() => jest.clearAllMocks());

  /** El canal web no tiene chat ni archivo de Telegram: solo la URL de R2. */
  it('registra en PROCESANDO una imagen ya subida', async () => {
    const validacion = await registrarValidacion(repositorio as any, {
      imageUrl: 'https://media.example.com/evidencias/transferencias/a.jpg',
      tipoCobro: 'reserva',
      recibidaEn: new Date('2026-11-16T20:05:07Z'),
    });

    expect(repositorio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: 'PROCESANDO',
        esComprobante: false,
        imageUrl: 'https://media.example.com/evidencias/transferencias/a.jpg',
        tipoCobro: 'reserva',
        horaRecepcion: '20:05:07',
        chatId: undefined,
        telegramFileId: undefined,
      }),
    );
    expect(validacion.id).toBe('validacion-1');
  });

  it('vuelca lo leido y el monto esperado', () => {
    const validacion = aplicarAnalisis(
      { id: 'v' } as any,
      { esComprobante: true, monto: '500', idSpei: 'MBAN0001' },
      { valid: true, amount: 500 },
      { expectedAmount: 500, jefeId: 'jefe-1' },
    );
    expect(validacion).toMatchObject({
      estado: 'APROBADO',
      monto: 500,
      montoEsperado: 500,
      idSpei: 'MBAN0001',
      jefeId: 'jefe-1',
      draftPayload: null,
    });
  });

  it('marca el error solo si seguia procesando', async () => {
    const procesando = { estado: 'PROCESANDO' } as any;
    await marcarErrorDeValidacion(
      repositorio as any,
      procesando,
      new Error('sin red'),
    );
    expect(procesando).toMatchObject({
      estado: 'ERROR_VALIDACION',
      observaciones: 'sin red',
    });

    const terminada = { estado: 'APROBADO' } as any;
    await marcarErrorDeValidacion(repositorio as any, terminada, new Error());
    expect(terminada.estado).toBe('APROBADO');
  });

  it('el fallo al guardar el error no se propaga', async () => {
    repositorio.save.mockRejectedValueOnce(new Error('base caida'));
    await expect(
      marcarErrorDeValidacion(
        repositorio as any,
        { estado: 'PROCESANDO' } as any,
        new Error('x'),
      ),
    ).resolves.toBeUndefined();
  });

  it('lee la clave de rastreo con cualquiera de sus nombres', () => {
    expect(claveSpeiDe({ trackingKey: 'A1' })).toBe('A1');
    expect(claveSpeiDe({ claveRastreo: 'B2' })).toBe('B2');
    expect(claveSpeiDe({ idSpei: '  ' })).toBeUndefined();
    expect(claveSpeiDe(null)).toBeUndefined();
  });
});

describe('enlazarComprobanteAServicio', () => {
  const servicio = { id: 'srv-1', estado: 'pendiente', jefeId: 'jefe-1' };
  let servicios: { findOne: jest.Mock };
  let validaciones: { update: jest.Mock };
  let realtime: { emitToBoss: jest.Mock };

  beforeEach(() => {
    servicios = { findOne: jest.fn().mockResolvedValue({ ...servicio }) };
    validaciones = { update: jest.fn().mockResolvedValue(undefined) };
    realtime = { emitToBoss: jest.fn() };
  });

  it('enlaza y avisa al panel sin tocar el pago pendiente', async () => {
    const enlazado = await enlazarComprobanteAServicio(
      { servicios, validaciones } as any,
      realtime,
      'srv-1',
      'val-1',
      jest.fn(),
    );
    expect(enlazado?.id).toBe('srv-1');
    expect(validaciones.update).toHaveBeenCalledWith('val-1', {
      servicioId: 'srv-1',
    });
    expect(realtime.emitToBoss).toHaveBeenCalledWith(
      'jefe-1',
      expect.objectContaining({ type: 'service_updated' }),
    );
  });

  it.each(['cancelado', 'finalizado'])(
    'no toca un servicio %s',
    async (estado) => {
      servicios.findOne.mockResolvedValue({ ...servicio, estado });
      await expect(
        enlazarComprobanteAServicio(
          { servicios, validaciones } as any,
          realtime,
          'srv-1',
          'val-1',
          jest.fn(),
        ),
      ).resolves.toBeNull();
      expect(validaciones.update).not.toHaveBeenCalled();
    },
  );

  it('un fallo al enlazar se reporta y no interrumpe el aviso', async () => {
    const error = new Error('fk');
    validaciones.update.mockRejectedValue(error);
    const alFallar = jest.fn();
    await enlazarComprobanteAServicio(
      { servicios, validaciones } as any,
      realtime,
      'srv-1',
      'val-1',
      alFallar,
    );
    expect(alFallar).toHaveBeenCalledWith(error);
    expect(realtime.emitToBoss).toHaveBeenCalled();
  });
});

describe('cuentasParaTransferir', () => {
  it('lista las cuentas activas con numero', () => {
    const texto = cuentasParaTransferir([
      CUENTA,
      { ...CUENTA, banco: 'Inactiva', activa: false },
      { ...CUENTA, banco: 'Sin numero', cuenta: null, clabe: null },
    ]);
    expect(texto).toBe(
      '1. BBVA\nTitular: Omar Pérez\nCuenta/tarjeta: 4152314214309919\nCLABE: 012180001234567891',
    );
  });

  it('sin cuentas utiles devuelve null', () => {
    expect(cuentasParaTransferir([])).toBeNull();
  });
});
