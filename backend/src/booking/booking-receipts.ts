import type { Repository } from 'typeorm';
import { toCents } from '../common/money';
import {
  montoEsperadoDeTransferencia,
  type BorradorDeReserva,
} from './datos-de-reserva';
import type { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import type { PaymentReceiptValidations } from '../services/entities/payment-receipt-validation.entity';
import type { Servicios } from '../services/entities/service.entity';

/**
 * Comprobantes de transferencia, independientes del canal.
 *
 * La web recibe la foto por multipart y, una vez subida a R2, se registra la
 * validacion, se analiza, se guarda el resultado y, si procede, se engancha al
 * servicio que la esperaba. Vive aqui como funciones que reciben sus
 * repositorios, para que quien las use no cambie sus dependencias.
 *
 * Regla que no se toca: el analisis de la IA solo lee la foto. Ni un
 * `APROBADO` confirma el dinero; eso solo lo hace una persona contrastando el
 * CEP (`ServicesService.confirmReceiptWithCep`).
 */

/** Etapa del cobro a la que pertenece un comprobante. */
export type TipoDeCobro = 'reserva' | 'final' | 'grupal';

/** Lo que concluye `validateReceiptAnalysis` sobre la foto. */
export interface ResultadoDeComprobante {
  valid: boolean;
  amount?: number;
  reason?: string;
  needsManualReview?: boolean;
}

export function parseReceiptAmount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  let normalized = value.replace(/[^\d.,-]/g, '').trim();
  if (!normalized) return undefined;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function normalizedDigits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function normalizedName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : '';
}

export function validateReceiptAnalysis(
  analysis: any,
  expectedAmount: number,
  accounts: AuthorizedBankAccounts[],
): ResultadoDeComprobante {
  if (analysis?.aiCallFailed === true) {
    return {
      valid: false,
      needsManualReview: true,
      reason:
        'No fue posible verificar automáticamente el comprobante; un asesor lo revisará en breve.',
    };
  }
  const isReceipt = Boolean(analysis?.valid ?? analysis?.esComprobante);
  if (!isReceipt) {
    return {
      valid: false,
      reason: 'La imagen no fue reconocida como comprobante bancario.',
    };
  }
  if (analysis?.analisisIA?.posibleFraude === true) {
    return {
      valid: false,
      reason:
        analysis.analisisIA.alertas?.join(', ') ||
        'El comprobante presenta señales de posible edición.',
    };
  }
  if (analysis?.estadoVisual?.textoLegible === false) {
    return {
      valid: false,
      reason: 'El texto del comprobante no es suficientemente legible.',
    };
  }

  const amount = parseReceiptAmount(analysis?.amount ?? analysis?.monto);
  if (!amount) {
    return {
      valid: false,
      needsManualReview: true,
      reason: 'La foto no muestra un monto legible; se conserva para revisión.',
    };
  }
  // En centavos: comparar flotantes con un epsilon a mano era lo que hacia
  // falta antes de `money.ts`.
  if (toCents(amount) < toCents(expectedAmount)) {
    return {
      valid: false,
      amount,
      reason: `El comprobante muestra $${amount.toFixed(2)}, pero se esperaban $${expectedAmount.toFixed(2)}.`,
    };
  }

  const activeAccounts = accounts.filter((account) => account.activa);
  if (!activeAccounts.length) {
    return {
      valid: false,
      amount,
      needsManualReview: true,
      reason: 'No hay cuentas de transferencia activas configuradas.',
    };
  }
  const extractedNumbers = [
    analysis?.destinationAccount,
    analysis?.cuentaDestino,
    analysis?.clabe,
    analysis?.ultimos4CuentaDestino,
  ]
    .map(normalizedDigits)
    .filter(Boolean);
  const extractedHolder = normalizedName(
    analysis?.destinationHolder ?? analysis?.titularDestino,
  );

  let strongMatch = false;
  let weakMatch = false;
  for (const account of activeAccounts) {
    const registeredNumbers = [account.cuenta, account.clabe]
      .map(normalizedDigits)
      .filter(Boolean);
    const registeredLast4 =
      normalizedDigits(account.ultimos4) ||
      registeredNumbers.find(Boolean)?.slice(-4) ||
      '';
    const numberMatches = extractedNumbers.some((extracted) =>
      extracted.length <= 4
        ? Boolean(registeredLast4 && extracted === registeredLast4)
        : registeredNumbers.some(
            (registered) =>
              registered === extracted ||
              registered.endsWith(extracted) ||
              extracted.endsWith(registered),
          ),
    );
    const registeredHolder = normalizedName(account.titular);
    const holderMatches = Boolean(
      extractedHolder &&
      registeredHolder &&
      (extractedHolder.includes(registeredHolder) ||
        registeredHolder.includes(extractedHolder)),
    );
    // Coincidencia parcial: mismo titular con últimos 4 dígitos con un solo
    // dígito distinto (posible error de OCR), útil para no rechazar de golpe
    // comprobantes legítimos con datos ligeramente mal leídos.
    const near4 =
      registeredLast4.length === 4 &&
      extractedNumbers.some((extracted) => {
        const last4 = extracted.length >= 4 ? extracted.slice(-4) : extracted;
        if (last4.length !== 4) return false;
        let shared = 0;
        for (let i = 0; i < 4; i++) {
          if (last4[i] === registeredLast4[i]) shared++;
        }
        return shared >= 3;
      });

    if (extractedNumbers.length ? numberMatches : holderMatches) {
      strongMatch = true;
      break;
    }
    if (holderMatches || near4) {
      weakMatch = true;
    }
  }

  if (!strongMatch && !weakMatch) {
    const missingDestination =
      extractedNumbers.length === 0 && !extractedHolder;
    return {
      valid: false,
      amount,
      needsManualReview: missingDestination,
      reason: missingDestination
        ? 'La foto no muestra la cuenta beneficiaria; se conserva para revisión.'
        : 'La cuenta, CLABE, últimos cuatro o titular del comprobante no coincide con una cuenta autorizada.',
    };
  }
  if (!strongMatch) {
    return {
      valid: false,
      amount,
      needsManualReview: true,
      reason:
        'La cuenta destino no coincide con certeza con ninguna cuenta autorizada; requiere revisión manual.',
    };
  }
  return { valid: true, amount };
}

/** Estado de la fila de validacion que corresponde a un resultado. */
export function estadoDeValidacion(
  resultado: ResultadoDeComprobante,
): 'APROBADO' | 'PENDIENTE_REVISION' | 'RECHAZADO' {
  if (resultado.valid) return 'APROBADO';
  return resultado.needsManualReview ? 'PENDIENTE_REVISION' : 'RECHAZADO';
}

/**
 * ¿Hay ya un comprobante de esta reserva en manos de alguien?
 *
 * Solo cuenta como tal el que se esta analizando ahora mismo, el que espera
 * revision de un jefe y el aprobado. Un `PROCESANDO` viejo no: significa que
 * el analisis se quedo a medias --el proceso murio, o la foto se guardo sin
 * llegar a analizarse-- y tratarlo como "ya lo tengo" dejaba al cliente
 * atrapado sin poder mandar otro mientras su reserva no avanzaba nunca.
 */
export function comprobanteEnCurso(
  validacion: Pick<PaymentReceiptValidations, 'estado' | 'createdAt'> | null,
  ventanaDeAnalisisMs: number,
  ahora: number = Date.now(),
): boolean {
  if (!validacion) return false;
  const estado = validacion.estado ?? '';
  if (estado === 'PENDIENTE_REVISION' || estado === 'APROBADO') return true;
  return (
    estado === 'PROCESANDO' &&
    ahora - new Date(validacion.createdAt).getTime() < ventanaDeAnalisisMs
  );
}

/** Lo que identifica una foto recien subida, sea cual sea el canal. */
export interface NuevaValidacion {
  /** URL de la imagen ya guardada en R2. */
  imageUrl: string;
  tipoCobro: TipoDeCobro;
  servicioId?: string;
  clienteNombre?: string | null;
  recibidaEn?: Date;
}

/**
 * Registra la validacion en `PROCESANDO` a partir de una imagen ya subida.
 *
 * Se guarda antes de analizar para que la foto quede en las evidencias del
 * panel aunque el analisis falle o el proceso muera a medias.
 */
export function registrarValidacion(
  repositorio: Repository<PaymentReceiptValidations>,
  datos: NuevaValidacion,
): Promise<PaymentReceiptValidations> {
  const recibidaEn = datos.recibidaEn ?? new Date();
  return repositorio.save(
    repositorio.create({
      fechaRecepcion: recibidaEn,
      // Las filas historicas guardan aqui la hora en UTC; se conserva para
      // no mezclar dos criterios en la misma columna.
      horaRecepcion: recibidaEn.toISOString().slice(11, 19),
      clienteNombre: datos.clienteNombre ?? undefined,
      imageUrl: datos.imageUrl,
      esComprobante: false,
      estado: 'PROCESANDO',
      servicioId: datos.servicioId,
      tipoCobro: datos.tipoCobro,
    }),
  );
}

export interface ExtrasDelAnalisis {
  jefeId?: string;
  draftPayload?: any;
  expectedAmount?: number;
}

/**
 * Vuelca en la validacion lo que leyo la IA y la conclusion. Acepta los
 * nombres en ingles y en español porque el analizador visual ha devuelto
 * ambos segun la version del prompt.
 */
export function aplicarAnalisis(
  validacion: PaymentReceiptValidations,
  analysis: any,
  resultado: ResultadoDeComprobante,
  extra?: ExtrasDelAnalisis,
): PaymentReceiptValidations {
  return Object.assign(validacion, {
    esComprobante: Boolean(analysis?.valid ?? analysis?.esComprobante),
    bancoOrigen: analysis?.bankOrigin ?? analysis?.bancoOrigen,
    bancoDestino: analysis?.bankDestination ?? analysis?.bancoDestino,
    titularDestino: analysis?.destinationHolder ?? analysis?.titularDestino,
    cuentaDestino: analysis?.destinationAccount ?? analysis?.cuentaDestino,
    clabe: analysis?.clabe,
    monto:
      resultado.amount ??
      parseReceiptAmount(analysis?.amount ?? analysis?.monto),
    montoEsperado: extra?.expectedAmount,
    fechaTransferencia: analysis?.transferDate ?? analysis?.fechaTransferencia,
    horaTransferencia: analysis?.transferTime ?? analysis?.horaTransferencia,
    referencia: analysis?.reference ?? analysis?.referencia,
    folio: analysis?.folio,
    idSpei: analysis?.trackingKey ?? analysis?.idSpei ?? analysis?.claveRastreo,
    concepto: analysis?.concept ?? analysis?.concepto,
    confianza: analysis?.confidence ?? analysis?.confianza,
    estado: estadoDeValidacion(resultado),
    observaciones: resultado.reason ?? analysis?.reason ?? null,
    jsonIA: analysis,
    jefeId: extra?.jefeId,
    draftPayload: extra?.draftPayload ?? null,
  });
}

/** `aplicarAnalisis` y guardar. */
export function guardarAnalisis(
  repositorio: Repository<PaymentReceiptValidations>,
  validacion: PaymentReceiptValidations,
  analysis: any,
  resultado: ResultadoDeComprobante,
  extra?: ExtrasDelAnalisis,
): Promise<PaymentReceiptValidations> {
  return repositorio.save(
    aplicarAnalisis(validacion, analysis, resultado, extra),
  );
}

/**
 * Deja constancia de que el analisis fallo. Solo toca una validacion que
 * seguia en `PROCESANDO`: si ya tenia resultado, el fallo fue despues y ese
 * resultado vale. Nunca lanza; quien llama ya esta manejando otro error.
 */
export async function marcarErrorDeValidacion(
  repositorio: Repository<PaymentReceiptValidations>,
  validacion: PaymentReceiptValidations | undefined,
  error: unknown,
): Promise<void> {
  if (!validacion || validacion.estado !== 'PROCESANDO') return;
  validacion.estado = 'ERROR_VALIDACION';
  validacion.observaciones =
    error instanceof Error ? error.message : 'Error inesperado de validación';
  await repositorio.save(validacion).catch(() => undefined);
}

/** La clave de rastreo SPEI, venga con el nombre que venga. */
export function claveSpeiDe(analysis: any): string | undefined {
  const clave: unknown =
    analysis?.trackingKey ?? analysis?.idSpei ?? analysis?.claveRastreo;
  return typeof clave === 'string' && clave.trim() ? clave : undefined;
}

/** Lo que necesita `enlazarComprobanteAServicio` para avisar al panel. */
export interface AvisoDeServicio {
  emitToBoss(bossId: string | null | undefined, event: unknown): void;
}

/**
 * Engancha un comprobante al servicio que lo estaba esperando.
 *
 * Cuando la reserva se cierra antes de cobrar, el servicio ya existe y el
 * jefe ya lo tiene delante: la foto que llega despues no debe dar de alta uno
 * nuevo ni confirmar el dinero. Solo enlaza la evidencia y avisa al panel; la
 * marca de pago pendiente la quita quien confirme el CEP.
 *
 * Devuelve el servicio, o `null` si ya no esta o ya no admite comprobante,
 * para que quien llama siga por el camino de siempre. Un fallo al enlazar se
 * entrega a `alFallarEnlace` y no interrumpe: el aviso al jefe vale igual.
 */
export async function enlazarComprobanteAServicio(
  repositorios: {
    servicios: Pick<Repository<Servicios>, 'findOne'>;
    validaciones: Pick<Repository<PaymentReceiptValidations>, 'update'>;
  },
  realtime: AvisoDeServicio,
  servicioId: string,
  validationId: string,
  alFallarEnlace: (error: unknown) => void,
): Promise<Servicios | null> {
  const servicio = await repositorios.servicios.findOne({
    where: { id: servicioId },
    relations: { empleada: true, cliente: true },
  });
  if (!servicio) return null;
  if (['cancelado', 'finalizado'].includes(servicio.estado)) return null;

  await repositorios.validaciones
    .update(validationId, { servicioId })
    .catch(alFallarEnlace);

  realtime.emitToBoss(servicio.jefeId, {
    type: 'service_updated',
    data: servicio,
  });
  return servicio;
}

/**
 * Las cuentas autorizadas como se le escriben al cliente. Mismo formato que
 * `ServicesService.bankTransferDetails`, sin formato Markdown. Devuelve
 * `null` si no hay ninguna con numero que dar, para que quien llama decida el
 * texto alternativo.
 */
export function cuentasParaTransferir(
  cuentas: AuthorizedBankAccounts[],
): string | null {
  const utiles = cuentas.filter(
    (cuenta) => cuenta.activa && (cuenta.cuenta || cuenta.clabe),
  );
  if (!utiles.length) return null;
  return utiles
    .map((cuenta, indice) =>
      [
        `${indice + 1}. ${cuenta.banco}`,
        `Titular: ${cuenta.titular}`,
        cuenta.cuenta ? `Cuenta/tarjeta: ${cuenta.cuenta}` : null,
        cuenta.clabe ? `CLABE: ${cuenta.clabe}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/**
 * Lo que tiene que decir el comprobante de una reserva, o `null` si todavia
 * no hay monto con el que compararlo: sin duracion pactada, o en pago mixto
 * sin la parte por transferencia acordada (la web aun no la pregunta).
 */
export function montoEsperadoDelComprobante(
  borrador: BorradorDeReserva,
  precioBaseHora: number | string,
): number | null {
  const sinMonto =
    borrador.metodoPago === 'mixto'
      ? !borrador.mixedTransferAmount
      : !borrador.duracionPactadaHoras;
  if (sinMonto) return null;
  return montoEsperadoDeTransferencia(borrador, precioBaseHora);
}
