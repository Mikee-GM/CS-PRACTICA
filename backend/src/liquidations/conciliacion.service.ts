import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { fromCents, toCents } from '../common/money';
import { desdeHoraDelNegocio, lunesDeLaSemana } from '../common/locale';
import {
  calculateCut,
  DEFAULT_CARD_EXTRA_COMMISSION,
} from './liquidation-calculator';
import { LiquidationsRepository } from './liquidations.repository';
import { OfficeLiquidationSyncService } from './office-liquidation-sync.service';
import {
  consultaDeVerificacion,
  VERIFICACIONES,
} from './conciliacion.verificaciones';

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DE_CASOS_A_MOSTRAR = 25;

export type CasoDeDiscrepancia = {
  referencia: string;
  servicioId: string | null;
  esperado: number;
  real: number;
  diferencia: number;
  detalle: string;
};

export type ResultadoDeVerificacion = {
  id: string;
  titulo: string;
  descripcion: string;
  estado: 'ok' | 'discrepancia';
  casos: number;
  /** Suma de las diferencias en valor absoluto. */
  diferenciaTotal: number;
  muestra: CasoDeDiscrepancia[];
};

export type ResumenDeDinero = {
  servicios: number;
  cobradoTotal: number;
  cobradoEnEfectivo: number;
  cobradoConTarjeta: number;
  cobradoPorTransferencia: number;
  base: number;
  extras: number;
  extrasConTarjeta: number;
  comisionExtrasTarjeta: number;
  transporteCobradoAlCliente: number;
  parteDeLaEmpresa: number;
  multasDelPeriodo: number;
  pagoAChoferes: number;
  pagoAChoferesLiquidado: number;
  pagoAChoferesPendiente: number;
  viajesDeChoferes: number;
  costoDeUber: number;
  efectivoPorCobrar: number;
  efectivoPorCobrarListo: number;
  efectivoPorCobrarProvisional: number;
  obligacionesAbiertas: number;
  abonosDeEfectivoDelPeriodo: number;
  deudasAbiertas: number;
  cortesConfirmados: number;
  pagadoEnCortes: number;
  /** Empleadas con registros en el periodo y el corte sin confirmar. */
  cortesPorConfirmar: number;
  /** Lo que se les debe en esos cortes todavia sin confirmar. */
  porPagarEnCortesPorConfirmar: number;
  multasDeChoferesSinDescontar: number;
  /**
   * Parte de la empresa mas transporte cobrado al cliente, menos lo que se paga a
   * choferes y a Uber. Es una estimacion: los gastos de la oficina no estan aqui.
   */
  resultadoDeLaEmpresa: number;
};

export type Conciliacion = {
  desde: string;
  hasta: string;
  generadoAt: string;
  estado: 'ok' | 'discrepancia';
  discrepancias: number;
  resumen: ResumenDeDinero;
  verificaciones: ResultadoDeVerificacion[];
};

/** Fecha `AAAA-MM-DD` que existe de verdad (`2026-02-31` no). */
function esFechaReal(fecha: string): boolean {
  if (!SOLO_FECHA.test(fecha)) return false;
  const d = new Date(`${fecha}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Periodo a conciliar, en hora del negocio. `hasta` es inclusive para quien lo
 * pide y exclusivo (medianoche del dia siguiente) para las consultas. Sin
 * parametros, la semana en curso.
 */
export function periodoDeConciliacion(
  from?: string,
  to?: string,
  ahora: Date = new Date(),
): { from: string; to: string; desde: Date; hasta: Date } {
  const inicio = from ?? lunesDeLaSemana(ahora);
  const fin = to ?? sumarDias(inicio, 6);
  if (!esFechaReal(inicio) || !esFechaReal(fin)) {
    throw new BadRequestException('El periodo no es válido');
  }
  if (fin < inicio) {
    throw new BadRequestException('El periodo termina antes de empezar');
  }
  const desde = desdeHoraDelNegocio(`${inicio}T00:00:00`);
  const hasta = desdeHoraDelNegocio(`${sumarDias(fin, 1)}T00:00:00`);
  if (!desde || !hasta) {
    throw new BadRequestException('El periodo no es válido');
  }
  return { from: inicio, to: fin, desde, hasta };
}

/** Una columna de texto de una verificacion; vacia si no vino. */
function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

@Injectable()
export class ConciliacionService {
  private readonly logger = new Logger(ConciliacionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly records: LiquidationsRepository,
    private readonly sync: OfficeLiquidationSyncService,
  ) {}

  async conciliar(from?: string, to?: string): Promise<Conciliacion> {
    const periodo = periodoDeConciliacion(from, to);
    const { desde, hasta } = periodo;

    // Una sola instantanea de solo lectura: con lecturas sueltas, un servicio
    // que se cierra a mitad de la prueba aparece en unas verificaciones y en
    // otras no, y la conciliacion se descuadra sola.
    const { verificaciones, resumenSql, cortes } =
      await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        const resultados: ResultadoDeVerificacion[] = [];
        for (const definicion of VERIFICACIONES) {
          // Postgres rechaza parametros que la consulta no usa: algunas
          // verificaciones (las deudas) no dependen del periodo.
          // Las columnas se nombran por posicion: asi cada verificacion solo
          // tiene que devolver cinco columnas en orden, sin repetir alias.
          const filas: Array<Record<string, unknown>> = await manager.query(
            consultaDeVerificacion(definicion.sql),
            definicion.sql.includes('$1') ? [desde, hasta] : [],
          );
          resultados.push(this.resultado(definicion, filas));
        }
        return {
          verificaciones: resultados,
          resumenSql: await this.resumenSql(manager, desde, hasta),
          cortes: await manager.query<
            Array<{
              employee_id: string;
              week_start: string;
              week_end: string;
              gross_employee_pay: string;
            }>
          >(
            `SELECT employee_id, week_start::text, week_end::text, gross_employee_pay
               FROM employee_weekly_settlements
              WHERE week_start >= ($1::timestamptz AT TIME ZONE 'America/Mexico_City')::date - 7
                AND week_start < ($2::timestamptz AT TIME ZONE 'America/Mexico_City')::date`,
            [desde, hasta],
          ),
        };
      });

    verificaciones.push(await this.recalcularCortes(cortes));

    const registrosDelPeriodo = await this.records.findRecords(
      desde,
      new Date(hasta.getTime() - 1),
    );
    const corte = calculateCut(
      registrosDelPeriodo,
      DEFAULT_CARD_EXTRA_COMMISSION,
    );
    const resumen = this.armarResumen(
      resumenSql,
      corte,
      this.cortesPorConfirmar(registrosDelPeriodo, cortes, periodo.from),
    );

    const discrepancias = verificaciones.reduce((n, v) => n + v.casos, 0);
    return {
      desde: periodo.from,
      hasta: periodo.to,
      generadoAt: new Date().toISOString(),
      estado: discrepancias === 0 ? 'ok' : 'discrepancia',
      discrepancias,
      resumen,
      verificaciones,
    };
  }

  /**
   * Vuelve a generar el registro de liquidacion de un servicio que quedo
   * desactualizado o sin registro.
   *
   * Se niega si el registro ya vive en una semana con el corte confirmado: cambiar
   * el pasado despues de pagar es justo la discrepancia que se quiere evitar.
   */
  async resincronizar(servicioId: string, adminId: string): Promise<void> {
    const [servicio] = await this.dataSource.query<
      Array<{ estado: string; empleada_id: string | null; fin: Date | null }>
    >(
      `SELECT estado, empleada_id, hora_fin_servicio AS fin FROM servicios WHERE id = $1`,
      [servicioId],
    );
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    if (
      servicio.estado !== 'finalizado' ||
      !servicio.fin ||
      !servicio.empleada_id
    ) {
      throw new ConflictException(
        'Solo se puede regenerar el registro de un servicio terminado',
      );
    }
    // Cuenta la semana donde vive hoy el registro: un servicio sin registro cuya
    // semana ya esta cerrada entra en la semana siguiente, sin tocar la pagada.
    const [cerrada] = await this.dataSource.query(
      `SELECT 1 FROM liquidation_records r
        JOIN employee_weekly_settlements w ON w.employee_id = r.employee_id
         AND (r.occurred_at AT TIME ZONE 'America/Mexico_City')::date
             BETWEEN w.week_start AND w.week_end
        WHERE r.service_id = $1 AND r.employee_id = $2 AND NOT r.is_fine
        LIMIT 1`,
      [servicioId, servicio.empleada_id],
    );
    if (cerrada) {
      throw new ConflictException(
        'El corte de esa semana ya está confirmado: deshazlo antes de regenerar el registro',
      );
    }
    await this.sync.syncOfficeRecord(servicioId);
    this.logger.log(
      `Registro de liquidacion del servicio ${servicioId} regenerado por ${adminId}`,
    );
  }

  private resultado(
    definicion: { id: string; titulo: string; descripcion: string },
    filas: Array<Record<string, unknown>>,
  ): ResultadoDeVerificacion {
    const casos: CasoDeDiscrepancia[] = filas.map((fila) => {
      const esperado = toCents(Number(fila.esperado ?? 0));
      const real = toCents(Number(fila.real ?? 0));
      return {
        referencia: textoDe(fila.referencia),
        servicioId: (fila.servicio_id as string | null) ?? null,
        esperado: fromCents(esperado),
        real: fromCents(real),
        diferencia: fromCents(real - esperado),
        detalle: textoDe(fila.detalle),
      };
    });
    const total = casos.reduce(
      (suma, caso) => suma + Math.abs(toCents(caso.diferencia)),
      0,
    );
    return {
      id: definicion.id,
      titulo: definicion.titulo,
      descripcion: definicion.descripcion,
      estado: casos.length === 0 ? 'ok' : 'discrepancia',
      casos: casos.length,
      diferenciaTotal: fromCents(total),
      muestra: casos.slice(0, MAXIMO_DE_CASOS_A_MOSTRAR),
    };
  }

  /**
   * Un corte confirmado guarda lo que se le pago a la empleada ese dia. Si
   * despues entra un servicio de esa semana o se cambia una multa, el corte
   * recalculado ya no coincide con lo pagado: aqui se ve.
   */
  private async recalcularCortes(
    cortes: Array<{
      employee_id: string;
      week_start: string;
      week_end: string;
      gross_employee_pay: string;
    }>,
  ): Promise<ResultadoDeVerificacion> {
    const casos: CasoDeDiscrepancia[] = [];
    for (const corte of cortes) {
      const desde = desdeHoraDelNegocio(`${corte.week_start}T00:00:00`);
      const siguiente = desdeHoraDelNegocio(
        `${sumarDias(corte.week_end, 1)}T00:00:00`,
      );
      if (!desde || !siguiente) continue;
      const recalculado = calculateCut(
        await this.records.findRecords(
          desde,
          new Date(siguiente.getTime() - 1),
          corte.employee_id,
        ),
        DEFAULT_CARD_EXTRA_COMMISSION,
      ).employeeGrossPay;
      const pagado = Number(corte.gross_employee_pay);
      const diferencia = toCents(recalculado) - toCents(pagado);
      if (diferencia !== 0) {
        casos.push({
          referencia: `corte ${corte.week_start} de ${corte.employee_id.slice(0, 8)}`,
          servicioId: null,
          esperado: fromCents(toCents(recalculado)),
          real: fromCents(toCents(pagado)),
          diferencia: fromCents(diferencia),
          detalle:
            'el corte confirmado ya no coincide con lo que dan hoy los registros de esa semana',
        });
      }
    }
    return {
      id: 'corte-recalculado',
      titulo:
        'Cortes confirmados: lo pagado coincide con los registros de la semana',
      descripcion:
        'Se vuelve a calcular cada corte confirmado con los registros actuales de su semana y se compara con lo que se le pago a la empleada.',
      estado: casos.length === 0 ? 'ok' : 'discrepancia',
      casos: casos.length,
      diferenciaTotal: fromCents(
        casos.reduce((s, c) => s + Math.abs(toCents(c.diferencia)), 0),
      ),
      muestra: casos.slice(0, MAXIMO_DE_CASOS_A_MOSTRAR),
    };
  }

  private async resumenSql(
    manager: { query: <T>(sql: string, params?: unknown[]) => Promise<T> },
    desde: Date,
    hasta: Date,
  ) {
    const [servicios] = await manager.query<Array<Record<string, string>>>(
      `SELECT count(*) AS servicios,
              COALESCE(sum(total_final), 0) AS cobrado,
              COALESCE(sum(total_final) FILTER (WHERE metodo_pago = 'efectivo'), 0) AS efectivo,
              COALESCE(sum(total_final) FILTER (WHERE metodo_pago = 'tarjeta'), 0) AS tarjeta,
              COALESCE(sum(total_final) FILTER (WHERE metodo_pago = 'transferencia'), 0) AS transferencia,
              COALESCE(sum(total_base), 0) AS base,
              COALESCE(sum(total_extras), 0) AS extras,
              COALESCE(sum(COALESCE(customer_transport_charge, total_transporte, 0)), 0) AS transporte
         FROM servicios s
        WHERE s.estado = 'finalizado'
          AND s.hora_fin_servicio >= $1 AND s.hora_fin_servicio < $2`,
      [desde, hasta],
    );
    const [extras] = await manager.query<Array<Record<string, string>>>(
      `SELECT COALESCE(sum(e.precio_cobrado) FILTER (WHERE e.metodo_pago::text = 'tarjeta'), 0) AS tarjeta,
              COALESCE(sum(e.company_commission_snapshot), 0) AS comision
         FROM extras_servicio e JOIN servicios s ON s.id = e.servicio_id
        WHERE s.estado = 'finalizado'
          AND s.hora_fin_servicio >= $1 AND s.hora_fin_servicio < $2`,
      [desde, hasta],
    );
    const [choferes] = await manager.query<Array<Record<string, string>>>(
      `SELECT count(*) AS viajes,
              COALESCE(sum(driver_payout), 0) AS total,
              COALESCE(sum(driver_payout) FILTER (WHERE driver_settlement_id IS NOT NULL), 0) AS liquidado
         FROM viajes
        WHERE proveedor_transporte = 'interno' AND estado = 'finalizado'
          AND hora_fin_viaje >= $1 AND hora_fin_viaje < $2`,
      [desde, hasta],
    );
    const [uber] = await manager.query<Array<Record<string, string>>>(
      `SELECT COALESCE(sum(tarifa), 0) AS total FROM viajes
        WHERE proveedor_transporte = 'uber' AND estado = 'finalizado'
          AND fare_confirmed_at IS NOT NULL
          AND hora_fin_viaje >= $1 AND hora_fin_viaje < $2`,
      [desde, hasta],
    );
    const [efectivo] = await manager.query<Array<Record<string, string>>>(
      `SELECT count(*) AS abiertas,
              COALESCE(sum(amount - paid_amount), 0) AS total,
              COALESCE(sum(amount - paid_amount) FILTER (WHERE calculation_status = 'ready'), 0) AS listo,
              COALESCE(sum(amount - paid_amount) FILTER (WHERE calculation_status <> 'ready'), 0) AS provisional
         FROM employee_cash_obligations
        WHERE status <> 'paid' AND NOT administratively_excluded`,
    );
    const [abonos] = await manager.query<Array<Record<string, string>>>(
      `SELECT COALESCE(sum(amount), 0) AS total FROM employee_cash_payments
        WHERE reverted_at IS NULL AND created_at >= $1 AND created_at < $2`,
      [desde, hasta],
    );
    const [multas] = await manager.query<Array<Record<string, string>>>(
      `SELECT COALESCE(sum(fine_amount), 0) AS total FROM liquidation_records
        WHERE is_fine AND NOT excluded_from_cut
          AND occurred_at >= $1 AND occurred_at < $2`,
      [desde, hasta],
    );
    const [deudas] = await manager.query<Array<Record<string, string>>>(
      `SELECT COALESCE(sum(d.amount), 0)
            - COALESCE((SELECT sum(p.amount) FROM liquidation_payments p
                         JOIN liquidation_debts d2 ON d2.id = p.debt_id
                        WHERE p.deleted_at IS NULL AND d2.deleted_at IS NULL), 0) AS abiertas
         FROM liquidation_debts d WHERE d.deleted_at IS NULL`,
    );
    const [cortes] = await manager.query<Array<Record<string, string>>>(
      `SELECT count(*) AS confirmados,
              COALESCE(sum(net_employee_pay), 0) AS pagado
         FROM employee_weekly_settlements
        WHERE confirmed_at >= $1 AND confirmed_at < $2`,
      [desde, hasta],
    );
    const [multasChoferes] = await manager.query<Array<Record<string, string>>>(
      `SELECT COALESCE(sum(fine_amount), 0) AS total FROM disciplinary_sanctions
        WHERE type = 'fine' AND subject_type = 'driver' AND status = 'active'
          AND driver_settlement_id IS NULL`,
    );
    return {
      servicios,
      extras,
      choferes,
      uber,
      efectivo,
      abonos,
      multas,
      deudas,
      cortes,
      multasChoferes,
    };
  }

  /**
   * Empleadas con registros en la semana cuyo corte aun no se confirmo, y lo que
   * se les debe. Sin esto, saber cuanto falta por pagar obliga a abrir a cada
   * empleada una por una.
   */
  private cortesPorConfirmar(
    registros: Awaited<ReturnType<LiquidationsRepository['findRecords']>>,
    cortes: Array<{ employee_id: string; week_start: string }>,
    inicioDelPeriodo: string,
  ): { cantidad: number; importe: number } {
    const confirmadas = new Set(
      cortes
        .filter((corte) => corte.week_start === inicioDelPeriodo)
        .map((corte) => corte.employee_id),
    );
    const porEmpleada = new Map<string, typeof registros>();
    for (const registro of registros) {
      if (confirmadas.has(registro.employeeId)) continue;
      const lista = porEmpleada.get(registro.employeeId) ?? [];
      lista.push(registro);
      porEmpleada.set(registro.employeeId, lista);
    }
    let importe = 0;
    for (const lista of porEmpleada.values()) {
      importe += toCents(
        calculateCut(lista, DEFAULT_CARD_EXTRA_COMMISSION).employeeGrossPay,
      );
    }
    return { cantidad: porEmpleada.size, importe: fromCents(importe) };
  }

  private armarResumen(
    sql: Awaited<ReturnType<ConciliacionService['resumenSql']>>,
    corte: ReturnType<typeof calculateCut>,
    porConfirmar: { cantidad: number; importe: number },
  ): ResumenDeDinero {
    const n = (valor: string | number | undefined) =>
      toCents(Number(valor ?? 0));
    const choferes = n(sql.choferes.total);
    const uber = n(sql.uber.total);
    const resultado =
      toCents(corte.companyCommission) +
      toCents(corte.customerTransportCharges) -
      choferes -
      uber;
    return {
      servicios: Number(sql.servicios.servicios),
      cobradoTotal: fromCents(n(sql.servicios.cobrado)),
      cobradoEnEfectivo: fromCents(n(sql.servicios.efectivo)),
      cobradoConTarjeta: fromCents(n(sql.servicios.tarjeta)),
      cobradoPorTransferencia: fromCents(n(sql.servicios.transferencia)),
      base: fromCents(n(sql.servicios.base)),
      extras: fromCents(n(sql.servicios.extras)),
      extrasConTarjeta: fromCents(n(sql.extras.tarjeta)),
      comisionExtrasTarjeta: fromCents(n(sql.extras.comision)),
      transporteCobradoAlCliente: fromCents(n(sql.servicios.transporte)),
      parteDeLaEmpresa: corte.companyCommission,
      multasDelPeriodo: fromCents(n(sql.multas.total)),
      pagoAChoferes: fromCents(choferes),
      pagoAChoferesLiquidado: fromCents(n(sql.choferes.liquidado)),
      pagoAChoferesPendiente: fromCents(choferes - n(sql.choferes.liquidado)),
      viajesDeChoferes: Number(sql.choferes.viajes),
      costoDeUber: fromCents(uber),
      efectivoPorCobrar: fromCents(n(sql.efectivo.total)),
      efectivoPorCobrarListo: fromCents(n(sql.efectivo.listo)),
      efectivoPorCobrarProvisional: fromCents(n(sql.efectivo.provisional)),
      obligacionesAbiertas: Number(sql.efectivo.abiertas),
      abonosDeEfectivoDelPeriodo: fromCents(n(sql.abonos.total)),
      deudasAbiertas: fromCents(n(sql.deudas.abiertas)),
      cortesConfirmados: Number(sql.cortes.confirmados),
      pagadoEnCortes: fromCents(n(sql.cortes.pagado)),
      cortesPorConfirmar: porConfirmar.cantidad,
      porPagarEnCortesPorConfirmar: porConfirmar.importe,
      multasDeChoferesSinDescontar: fromCents(n(sql.multasChoferes.total)),
      resultadoDeLaEmpresa: fromCents(resultado),
    };
  }
}
