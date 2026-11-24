import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Servicios } from '../services/entities/service.entity';
import { LiquidationRecord } from './entities/liquidation-record.entity';
import { EmployeeCashObligation } from '../transport-operations/entities/employee-cash-obligation.entity';
import { fromCents, sumMoney, toCents } from '../common/money';
import { desdeHoraDelNegocio, lunesDeLaSemana } from '../common/locale';

@Injectable()
export class OfficeLiquidationSyncService {
  private readonly logger = new Logger(OfficeLiquidationSyncService.name);

  constructor(
    @InjectRepository(Servicios)
    private readonly services: Repository<Servicios>,
    @InjectRepository(LiquidationRecord)
    private readonly records: Repository<LiquidationRecord>,
    @InjectRepository(EmployeeCashObligation)
    private readonly cashObligations: Repository<EmployeeCashObligation>,
  ) {}

  /**
   * Fecha con la que un servicio entra al corte semanal de la empleada.
   *
   * Si el servicio termino en una semana cuyo corte ya esta confirmado, no se
   * reescribe esa semana: cuenta en la primera semana siguiente que siga abierta
   * (su lunes a medianoche, en hora de Mexico). Un registro que ya vive en una
   * semana confirmada conserva su fecha.
   */
  private async fechaDeCorteAbierto(
    employeeId: string,
    termino: Date,
    actual: Date | null,
  ): Promise<Date> {
    const cerrada = async (momento: Date) => {
      const filas: unknown[] = await this.records.manager.query(
        `SELECT 1 FROM employee_weekly_settlements w
          WHERE w.employee_id = $1
            AND ($2::timestamptz AT TIME ZONE 'America/Mexico_City')::date
                BETWEEN w.week_start AND w.week_end
          LIMIT 1`,
        [employeeId, momento],
      );
      return filas.length > 0;
    };

    if (actual && (await cerrada(new Date(actual)))) return new Date(actual);

    let fecha = new Date(termino);
    // Tope de seguridad: ninguna empleada tiene un ano de cortes confirmados por delante.
    for (let i = 0; i < 60 && (await cerrada(fecha)); i++) {
      const lunes = new Date(`${lunesDeLaSemana(fecha)}T12:00:00.000Z`);
      lunes.setUTCDate(lunes.getUTCDate() + 7);
      fecha =
        desdeHoraDelNegocio(`${lunes.toISOString().slice(0, 10)}T00:00:00`) ??
        fecha;
    }
    return fecha;
  }

  /**
   * Registro de corte de un servicio cancelado.
   *
   * `syncOfficeRecord` solo corre con el servicio finalizado, asi que el Uber
   * que ya se habia pedido cuando se cancelo no llegaba a ningun corte: la
   * empresa lo pagaba y en los numeros no aparecia. El calculador ya sabia que
   * hacer con esto —un registro con `cancelled` conserva el transporte pero
   * ignora venta y comision— pero nadie escribia nunca ese registro.
   *
   * Que el cliente pague o no ese traslado no es una regla fija: si cancelo
   * tarde y el carro ya iba en camino se le cobra, y si fue un error de la
   * oficina no. Por eso el cobro sale de lo que se marco viaje por viaje al
   * cerrar el costo, y no de una politica general.
   */
  async syncCancelledRecord(
    serviceId: string,
  ): Promise<LiquidationRecord | null> {
    const service = await this.services.findOne({
      where: { id: serviceId },
      relations: { jefe: true, viajes: true },
    });

    if (!service || service.estado !== 'cancelado') {
      return null;
    }
    if (!service.empleadaId || !service.jefeId || !service.jefe) {
      return null;
    }
    if (service.jefe.rol !== 'admin' && service.jefe.rol !== 'jefe') {
      return null;
    }

    // Solo cuenta el transporte con costo ya cerrado: un Uber pendiente de
    // confirmar entraria como cero y falsearia el corte de la semana.
    const cerrados = (service.viajes ?? []).filter((trip) =>
      trip.proveedorTransporte === 'uber'
        ? Boolean(trip.fareConfirmedAt)
        : true,
    );
    const costoDe = (trip: (typeof cerrados)[number]) =>
      trip.proveedorTransporte === 'uber'
        ? Number(trip.tarifa || 0)
        : Number(trip.driverPayout || 0);

    const transportCost = sumMoney(cerrados.map(costoDe));

    // Lo que se le recupera al cliente de esos traslados. La oficina lo decide
    // viaje por viaje al cerrar el costo; lo que no se cobra lo absorbe la casa.
    const customerCharge = sumMoney(
      cerrados.filter((trip) => trip.costoCobradoAlCliente).map(costoDe),
    );

    const existing = await this.records.findOne({
      where: { serviceId: service.id, employeeId: service.empleadaId },
    });

    // Sin costo y sin registro previo no hay nada que anotar: un corte lleno de
    // cancelaciones en cero solo estorba.
    if (transportCost === 0 && !existing) {
      return null;
    }

    const value: Partial<LiquidationRecord> = {
      serviceId: service.id,
      employeeId: service.empleadaId,
      registeredByUserId: service.jefeId,
      sourceRole: service.jefe.rol,
      occurredAt: service.canceladoAt ?? service.createdAt,
      cancelled: true,
      serviceTotal: 0,
      paymentMethod: service.metodoPago,
      cashAmount: 0,
      cardAmounts: [],
      companyPercentage: 40,
      extraAmount: 0,
      companyTransportExpense: transportCost,
      customerTransportCharge: customerCharge,
      employeeUberReimbursement: 0,
      employeeCashDue: 0,
      electronicExtraAmount: 0,
      cardExtraAmount: 0,
      transportExcess: 0,
      promotion: false,
      membershipAmount: 0,
      place: null,
      hasOutboundDriver: false,
      hasReturnDriver: false,
      isFine: false,
      fineAmount: 0,
      updatedAt: new Date(),
    };

    return this.records.save(
      existing
        ? this.records.merge(existing, value)
        : this.records.create(value),
    );
  }

  async syncOfficeRecord(serviceId: string): Promise<LiquidationRecord | null> {
    const service = await this.services.findOne({
      where: { id: serviceId },
      relations: {
        jefe: true,
        viajes: true,
        extrasServicios: true,
        participantes: true,
      },
    });

    if (!service) {
      this.logger.warn(`No se sincronizó el servicio inexistente ${serviceId}`);
      return null;
    }
    if (service.estado !== 'finalizado' || !service.horaFinServicio) {
      return null;
    }
    if (!service.empleadaId || !service.jefeId || !service.jefe) {
      this.logger.warn(`El servicio ${serviceId} no tiene empleada o jefe`);
      return null;
    }
    if (service.jefe.rol !== 'admin' && service.jefe.rol !== 'jefe') {
      this.logger.warn(
        `El responsable del servicio ${serviceId} no puede registrar cortes`,
      );
      return null;
    }

    const electronic =
      service.metodoPago === 'tarjeta' ||
      service.metodoPago === 'transferencia';
    const outboundDriver = service.viajes?.some(
      (trip) => trip.tipo === 'ida' && trip.proveedorTransporte === 'interno',
    );
    const returnDriver = service.viajes?.some(
      (trip) =>
        trip.tipo === 'regreso' && trip.proveedorTransporte === 'interno',
    );
    const uberCost = sumMoney(
      (service.viajes ?? [])
        .filter(
          (trip) =>
            trip.proveedorTransporte === 'uber' &&
            !['cancelado', 'rechazado'].includes(trip.estado) &&
            Boolean(trip.fareConfirmedAt),
        )
        .map((trip) => trip.tarifa),
    );
    const customerCharge = Number(
      service.customerTransportCharge ?? service.totalTransporte ?? 0,
    );
    const employeeUberReimbursement = electronic ? uberCost : 0;
    const employeeCashDue =
      service.metodoPago === 'efectivo'
        ? fromCents(
            Math.max(0, toCents(service.totalFinal) - toCents(uberCost)),
          )
        : 0;
    const participantRows =
      service.serviceType === 'grupal' && service.participantes?.length
        ? service.participantes.filter(
            (participant) => participant.status !== 'cancelada',
          )
        : [
            {
              id: null,
              employeeId: service.empleadaId,
              role: 'responsable',
              confirmedSubtotal: Number(service.totalBase),
            },
          ];
    const values = participantRows.map((participant) => {
      const responsible = participant.role === 'responsable';
      const participantExtras =
        service.serviceType === 'grupal'
          ? (service.extrasServicios ?? []).filter(
              (extra) => extra.participantId === participant.id,
            )
          : (service.extrasServicios ?? []);
      const extraAmount =
        service.serviceType === 'grupal'
          ? sumMoney(participantExtras.map((extra) => extra.precioCobrado))
          : Number(service.totalExtras);
      const electronicParticipantExtras = sumMoney(
        participantExtras
          .filter((extra) => extra.metodoPago !== 'efectivo')
          .map((extra) => extra.precioCobrado),
      );
      // Aparte de lo electronico: solo la tarjeta paga comision en el corte.
      const cardParticipantExtras = sumMoney(
        participantExtras
          .filter((extra) => extra.metodoPago === 'tarjeta')
          .map((extra) => extra.precioCobrado),
      );
      const cardExtraItems = participantExtras
        .filter((extra) => extra.metodoPago === 'tarjeta')
        .map((extra) => ({
          amount: Number(extra.precioCobrado),
          companyCommission: Number(extra.companyCommissionSnapshot),
          employeeNet: Number(extra.employeeNetSnapshot),
          snapshotStatus: extra.financialSnapshotStatus,
        }));
      const base = Number(participant.confirmedSubtotal);
      return {
        serviceId: service.id,
        employeeId: participant.employeeId,
        registeredByUserId: service.jefeId,
        sourceRole: service.jefe.rol as 'admin' | 'jefe',
        occurredAt: service.horaFinServicio!,
        serviceTotal: base,
        paymentMethod: service.metodoPago,
        cashAmount: service.metodoPago === 'efectivo' ? base : 0,
        cardAmounts: electronic ? [base] : [],
        companyPercentage: 40,
        extraAmount,
        companyTransportExpense: 0,
        customerTransportCharge: responsible ? customerCharge : 0,
        employeeUberReimbursement: responsible ? employeeUberReimbursement : 0,
        employeeCashDue: responsible ? employeeCashDue : 0,
        electronicExtraAmount: electronicParticipantExtras,
        cardExtraAmount: cardParticipantExtras,
        cardExtraItems,
        historicalServiceId: service.id,
        excludedFromCut: false,
        transportExcess: 0,
        promotion: false,
        membershipAmount: 0,
        place: null,
        hasOutboundDriver: responsible && outboundDriver,
        hasReturnDriver: responsible && returnDriver,
        cancelled: false,
        isFine: false,
        fineAmount: 0,
        updatedAt: new Date(),
      } satisfies Partial<LiquidationRecord>;
    });

    for (const value of values) {
      const existingRecord = await this.records.findOne({
        where: {
          serviceId: value.serviceId,
          employeeId: value.employeeId,
        },
      });
      value.occurredAt = await this.fechaDeCorteAbierto(
        value.employeeId!,
        value.occurredAt as Date,
        existingRecord?.occurredAt ?? null,
      );
      await this.records.save(
        existingRecord
          ? this.records.merge(existingRecord, value)
          : this.records.create(value),
      );
    }
    if (service.metodoPago === 'efectivo') {
      const existing = await this.cashObligations.findOneBy({
        serviceId: service.id,
      });
      if (existing?.status === 'paid') {
        return this.records.findOneOrFail({
          where: { serviceId: service.id, employeeId: service.empleadaId },
        });
      }
      const paidAmount = Number(existing?.paidAmount ?? 0);
      const returnTrip = service.viajes?.find(
        (trip) => trip.tipo === 'regreso',
      );
      const pendingUber = service.viajes?.find(
        (trip) =>
          trip.proveedorTransporte === 'uber' &&
          !['cancelado', 'rechazado'].includes(trip.estado) &&
          (trip.estado !== 'finalizado' || !trip.fareConfirmedAt),
      );
      const ready = Boolean(returnTrip) && !pendingUber;
      const pendingReason = !returnTrip
        ? 'Falta definir el viaje de regreso'
        : pendingUber
          ? `Falta confirmar el Uber de ${pendingUber.tipo}`
          : null;
      const obligationStatus =
        paidAmount >= employeeCashDue ? 'paid' : 'pending';
      await this.cashObligations.upsert(
        {
          serviceId: service.id,
          employeeId: service.empleadaId,
          amount: employeeCashDue,
          paidAmount,
          status: obligationStatus,
          calculationStatus:
            obligationStatus === 'paid'
              ? 'paid'
              : ready
                ? 'ready'
                : 'provisional',
          pendingReason,
          customerTotal: Number(service.totalFinal),
          uberDeduction: uberCost,
          serviceDate: service.horaFinServicio,
          updatedAt: new Date(),
        },
        ['serviceId'],
      );
    }
    return this.records.findOneOrFail({
      where: { serviceId: service.id, employeeId: service.empleadaId },
    });
  }
}
