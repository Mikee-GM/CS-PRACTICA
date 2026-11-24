import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import { Viajes } from '../trips/entities/trip.entity';
import { EmployeeCashObligation } from './entities/employee-cash-obligation.entity';
import {
  EmployeeCashPayment,
  EmployeeCashPaymentAllocation,
} from './entities/employee-cash-payment.entity';
import { DriverSettlement } from './entities/driver-settlement.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Choferes } from '../drivers/entities/driver.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AVISO_LIQUIDACION } from '../notifications/avisos-catalogo';
import { Usuarios } from '../users/entities/user.entity';
import { desdeHoraDelNegocio, lunesDeLaSemana } from '../common/locale';
import { fromCents, roundMoney, sumMoney, toCents } from '../common/money';
import { LiquidationAudit } from '../liquidations/entities/liquidation-audit.entity';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(EmployeeCashObligation)
    private readonly obligations: Repository<EmployeeCashObligation>,
    @InjectRepository(DriverSettlement)
    private readonly driverSettlements: Repository<DriverSettlement>,
    @InjectRepository(Viajes) private readonly trips: Repository<Viajes>,
    @InjectRepository(Empleadas)
    private readonly employees: Repository<Empleadas>,
    @InjectRepository(Choferes)
    private readonly drivers: Repository<Choferes>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Semana operativa (lunes a domingo, hora de Mexico) a la que pertenece una
   * fecha. Antes salia de `getDay` y `toISOString` con la zona del servidor:
   * en UTC, un viaje cerrado el domingo a las 20:00 caia en la semana siguiente.
   */
  private getWeekBounds(date: Date): { weekStart: string; weekEnd: string } {
    const weekStart = lunesDeLaSemana(date);
    const fin = new Date(`${weekStart}T12:00:00.000Z`);
    fin.setUTCDate(fin.getUTCDate() + 6);
    return { weekStart, weekEnd: fin.toISOString().slice(0, 10) };
  }

  /**
   * Rango `Between` de un periodo `YYYY-MM-DD` en hora de Mexico: desde la
   * medianoche del primer dia hasta el ultimo milisegundo del ultimo. Con
   * `T00:00:00Z` el periodo empezaba a las seis de la tarde del dia anterior.
   */
  private ventanaDeSemana(startDate: string, endDate: string) {
    const { desde, hasta } = this.limitesDeSemana(startDate, endDate);
    return Between(desde, hasta);
  }

  /** Primer y ultimo milisegundo del periodo, en hora de Mexico. */
  private limitesDeSemana(startDate: string, endDate: string) {
    // Solo `AAAA-MM-DD` y una fecha que exista: con una fecha ISO completa o con
    // `2026-02-31`, `toISOString` lanzaba RangeError y la ruta respondia 500.
    // Ademas, JavaScript convierte `2026-02-31` en el 3 de marzo sin avisar: se
    // comprueba que la fecha vuelva igual, para no desplazar un corte de dinero.
    const esFechaReal = (fecha: string) => {
      const d = new Date(`${fecha}T12:00:00.000Z`);
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
        !Number.isNaN(d.getTime()) &&
        d.toISOString().slice(0, 10) === fecha
      );
    };
    if (!esFechaReal(startDate) || !esFechaReal(endDate)) {
      throw new BadRequestException('El periodo no es válido');
    }
    const siguiente = new Date(`${endDate}T12:00:00.000Z`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
    const desde = desdeHoraDelNegocio(`${startDate}T00:00:00`);
    const hasta = desdeHoraDelNegocio(
      `${siguiente.toISOString().slice(0, 10)}T00:00:00`,
    );
    if (!desde || !hasta) {
      throw new BadRequestException('El periodo no es válido');
    }
    return { desde, hasta: new Date(hasta.getTime() - 1) };
  }

  private async allowedEmployeeIds(actor: Usuarios): Promise<string[] | null> {
    if (actor.rol === 'admin') return null;
    const employees = await this.employees.find({
      where: [{ jefeId: actor.id }, { jefeSecundarioId: actor.id }],
      select: { id: true },
    });
    return employees.map((employee) => employee.id);
  }

  private async assertEmployeeAccess(employeeId: string, actor: Usuarios) {
    const allowed = await this.allowedEmployeeIds(actor);
    if (allowed && !allowed.includes(employeeId)) {
      throw new ConflictException('La empleada no pertenece a tu equipo');
    }
  }

  async cashSummary(actor: Usuarios, employeeId?: string) {
    const allowed = await this.allowedEmployeeIds(actor);
    if (employeeId) await this.assertEmployeeAccess(employeeId, actor);
    const where = employeeId
      ? { employeeId, administrativelyExcluded: false }
      : allowed
        ? {
            employeeId: In(
              allowed.length
                ? allowed
                : ['00000000-0000-0000-0000-000000000000'],
            ),
            administrativelyExcluded: false,
          }
        : { administrativelyExcluded: false };
    const rows = await this.obligations.find({
      where,
      order: { createdAt: 'ASC' },
    });
    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const employees = employeeIds.length
      ? await this.employees.findBy({ id: In(employeeIds) })
      : [];
    return {
      obligations: rows,
      employees: employees.map((employee) => ({
        id: employee.id,
        name: employee.nombreArtistico,
      })),
      total: fromCents(
        rows.reduce(
          (sum, row) =>
            sum + Math.max(0, toCents(row.amount) - toCents(row.paidAmount)),
          0,
        ),
      ),
    };
  }

  async registerCashPayment(
    employeeId: string,
    amount: number,
    note: string | undefined,
    actor: Usuarios,
  ) {
    await this.assertEmployeeAccess(employeeId, actor);
    const resultado = await this.dataSource.transaction(async (manager) => {
      const pending = await manager.getRepository(EmployeeCashObligation).find({
        where: {
          employeeId,
          status: 'pending',
          calculationStatus: 'ready',
          administrativelyExcluded: false,
        },
        order: { createdAt: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      // En centavos enteros: con flotantes, un abono por el saldo exacto podia
      // salir rechazado o dejar una obligacion a un centavo de quedar pagada.
      const availableCents = pending.reduce(
        (sum, row) => sum + toCents(row.amount) - toCents(row.paidAmount),
        0,
      );
      if (toCents(amount) > availableCents)
        throw new BadRequestException('El abono supera el saldo pendiente');
      const payment = await manager.getRepository(EmployeeCashPayment).save({
        employeeId,
        amount: roundMoney(amount),
        note: note ?? null,
        registeredByUserId: actor.id,
        origin: 'physical',
      });
      let remainingCents = toCents(amount);
      for (const obligation of pending) {
        if (remainingCents <= 0) break;
        const appliedCents = Math.min(
          remainingCents,
          toCents(obligation.amount) - toCents(obligation.paidAmount),
        );
        obligation.paidAmount = fromCents(
          toCents(obligation.paidAmount) + appliedCents,
        );
        obligation.status =
          toCents(obligation.paidAmount) >= toCents(obligation.amount)
            ? 'paid'
            : 'pending';
        if (obligation.status === 'paid') obligation.calculationStatus = 'paid';
        obligation.updatedAt = new Date();
        await manager.save(obligation);
        await manager.getRepository(EmployeeCashPaymentAllocation).save({
          paymentId: payment.id,
          obligationId: obligation.id,
          amount: fromCents(appliedCents),
        });
        remainingCents -= appliedCents;
      }
      return payment;
    });
    return resultado;
  }

  async closeCashObligation(id: string, actor: Usuarios) {
    const row = await this.obligations.findOneBy({ id });
    if (!row) throw new NotFoundException('Obligación no encontrada');
    await this.assertEmployeeAccess(row.employeeId, actor);
    if (row.calculationStatus !== 'ready') {
      throw new ConflictException(
        row.pendingReason || 'La entrega todavía es provisional',
      );
    }
    const remaining = fromCents(toCents(row.amount) - toCents(row.paidAmount));
    if (remaining <= 0) return row;
    await this.registerCashPayment(
      row.employeeId,
      remaining,
      `Cierre del servicio ${row.serviceId}`,
      actor,
    );
    return this.obligations.findOneByOrFail({ id });
  }

  /**
   * Abonos de efectivo de una empleada, para el historial de su ficha.
   *
   * Incluye los revertidos: son justamente lo que hay que poder ver para
   * entender por que un saldo cambio de un dia para otro.
   */
  async cashPayments(employeeId: string, actor: Usuarios) {
    await this.assertEmployeeAccess(employeeId, actor);
    return this.dataSource.getRepository(EmployeeCashPayment).find({
      where: { employeeId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Deshace un abono de efectivo.
   *
   * Se puede hacer sin adivinar nada porque `employee_cash_payment_allocations`
   * guarda que obligacion toco el abono y por cuanto: revertir es restar cada
   * asignacion de la obligacion correspondiente. Las filas de asignacion se
   * conservan —son la prueba de lo que se deshizo— y quien manda a partir de
   * aqui es la marca `revertedAt` del abono.
   *
   * Los abonos con origen `weekly_offset` no se revierten por aqui: los crea la
   * confirmacion del corte semanal, y deshacer solo el abono dejaria la fila de
   * la liquidacion diciendo que se pago algo que ya no esta pagado. Su entrada
   * es deshacer la liquidacion entera, que llama aqui con `permitirOffset`.
   */
  async revertCashPayment(
    paymentId: string,
    actor: Usuarios,
    reason?: string,
    permitirOffset = false,
  ) {
    return this.dataSource.transaction((manager) =>
      this.revertCashPaymentWith(
        manager,
        paymentId,
        actor,
        reason,
        permitirOffset,
      ),
    );
  }

  /**
   * La reversa en si, sobre un `EntityManager` que pone quien llama.
   *
   * Existe aparte porque deshacer la liquidacion semanal tiene que revertir el
   * abono y borrar la fila del corte en la misma transaccion: si solo una de
   * las dos cuajara, el efectivo quedaria contado como entregado sin corte que
   * lo respalde, o al reves.
   */
  async revertCashPaymentWith(
    manager: DataSource['manager'],
    paymentId: string,
    actor: Usuarios,
    reason?: string,
    permitirOffset = false,
  ) {
    const payments = manager.getRepository(EmployeeCashPayment);
    const payment = await payments.findOne({
      where: { id: paymentId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!payment) throw new NotFoundException('Abono no encontrado');
    await this.assertEmployeeAccess(payment.employeeId, actor);
    if (payment.revertedAt) {
      throw new ConflictException('El abono ya estaba revertido');
    }
    if (payment.origin === 'weekly_offset' && !permitirOffset) {
      throw new ConflictException(
        'Este abono lo generó el corte semanal: deshaz la liquidación de la semana',
      );
    }

    const allocations = await manager
      .getRepository(EmployeeCashPaymentAllocation)
      .findBy({ paymentId: payment.id });

    for (const allocation of allocations) {
      const obligation = await manager
        .getRepository(EmployeeCashObligation)
        .findOne({
          where: { id: allocation.obligationId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!obligation) continue;
      obligation.paidAmount = fromCents(
        Math.max(
          0,
          toCents(obligation.paidAmount) - toCents(allocation.amount),
        ),
      );
      obligation.status =
        toCents(obligation.paidAmount) >= toCents(obligation.amount)
          ? 'paid'
          : 'pending';
      /*
       * Vuelve a `ready`, no a `provisional`: el abono solo pudo aplicarse
       * sobre una obligacion ya calculada, asi que ese es su estado previo.
       */
      obligation.calculationStatus =
        obligation.status === 'paid' ? 'paid' : 'ready';
      obligation.updatedAt = new Date();
      await manager.save(obligation);
    }

    const antes = { ...payment };
    payment.revertedAt = new Date();
    payment.revertedByUserId = actor.id;
    payment.revertedReason = reason?.trim() || null;
    await payments.save(payment);

    /*
     * El asiento va al mismo registro que el resto del dinero
     * (`liquidation_audit_log`), aunque el abono viva en transporte: para
     * responder "quien movio este saldo y cuando" hace falta un solo sitio
     * donde mirar, no uno por modulo.
     */
    const auditoria = manager.getRepository(LiquidationAudit);
    await auditoria.save(
      auditoria.create({
        entityType: 'cash_payment',
        entityId: payment.id,
        action: 'reverted',
        actorUserId: actor.id,
        beforeValue: antes as unknown as Record<string, unknown>,
        afterValue: payment as unknown as Record<string, unknown>,
      }),
    );

    return payment;
  }

  async driverReport(startDate: string, endDate: string) {
    return this.trips.find({
      where: {
        proveedorTransporte: 'interno',
        estado: 'finalizado',
        horaFinViaje: this.ventanaDeSemana(startDate, endDate),
      },
      relations: { chofer: true, servicio: true },
      order: { horaFinViaje: 'ASC' },
    });
  }

  /**
   * Reabre una semana ya pagada de un chofer.
   *
   * La liquidacion de una modelo se podia deshacer desde el principio; la del
   * chofer no, y no hay razon para la asimetria: los dos casos son el mismo
   * --aparece un viaje que faltaba, o se cerro el periodo equivocado-- y el
   * numero queda mal sin forma de rehacerlo.
   *
   * Deshacer significa soltar los viajes que quedaron colgados de este corte,
   * para que la siguiente liquidacion vuelva a recogerlos. Las dos mitades van
   * en la misma transaccion: un corte marcado como pendiente con los viajes aun
   * enganchados dejaria una semana que nunca se puede volver a cerrar.
   *
   * Reservado al admin, igual que el de la modelo: deshacer mueve dinero en la
   * direccion en la que un error cuesta caro.
   */
  async undoDriverSettlement(
    driverId: string,
    startDate: string,
    actor: Usuarios,
    motivo: string,
  ) {
    if (actor.rol !== 'admin') {
      throw new ForbiddenException(
        'Solo un administrador puede deshacer la liquidación de un chofer',
      );
    }

    const resultado = await this.dataSource.transaction(async (manager) => {
      const settlement = await manager.getRepository(DriverSettlement).findOne({
        where: { driverId, weekStart: startDate },
        lock: { mode: 'pessimistic_write' },
      });
      if (!settlement) {
        throw new NotFoundException('Esa semana no tiene liquidación');
      }
      if (settlement.status !== 'paid') {
        throw new ConflictException('Esa semana no está pagada');
      }

      // Los viajes vuelven a quedar libres: es lo que permite que la proxima
      // liquidacion los recoja con el importe corregido.
      await manager.getRepository(Viajes).update(
        { driverSettlementId: settlement.id },
        {
          driverSettlementId: null,
        },
      );
      // Las multas descontadas en ese corte vuelven a quedar por descontar.
      await manager.query(
        `UPDATE disciplinary_sanctions SET driver_settlement_id = NULL WHERE driver_settlement_id = $1`,
        [settlement.id],
      );

      const reabierta = await manager.getRepository(DriverSettlement).save({
        ...settlement,
        status: 'pending',
        paidAt: null,
        paidByUserId: null,
        updatedAt: new Date(),
      });

      this.logger.log(
        `Liquidación del chofer ${driverId} de la semana ${startDate} deshecha por ${actor.id}: ${motivo}`,
      );
      return reabierta;
    });

    /*
     * Se le dijo que su liquidacion estaba lista y ahora ya no lo esta: es su
     * dinero, y enterarse mirando el portal por casualidad es peor que no
     * haberselo dicho nunca. Fuera de la transaccion y en su propio try/catch:
     * la semana ya esta reabierta.
     */
    const chofer = await this.drivers.findOne({
      where: { id: driverId },
      select: { id: true, usuarioId: true },
    });
    const usuarioId = chofer?.usuarioId;
    if (usuarioId) {
      try {
        await this.notifications.notificar(usuarioId, {
          titulo: 'Reabrimos tu liquidación',
          cuerpo: 'Hubo que corregir la semana. Toca para ver el detalle.',
          url: '/chofer/portal',
          tag: `liquidacion-${startDate}`,
          tipo: AVISO_LIQUIDACION,
        });
      } catch (err) {
        this.logger.error(
          'Error enviando el aviso push de la liquidación reabierta:',
          err,
        );
      }
    }

    return resultado;
  }

  async settleDriver(
    driverId: string,
    startDate: string,
    endDate: string,
    actorId: string,
  ) {
    const resultado = await this.dataSource.transaction(async (manager) => {
      const existing = await manager
        .getRepository(DriverSettlement)
        .findOneBy({ driverId, weekStart: startDate });
      if (existing?.status === 'paid')
        throw new ConflictException('La liquidación ya fue pagada');
      const { trips, multas, total } = await this.corteDelChofer(
        manager,
        driverId,
        startDate,
        endDate,
        true,
      );
      const settlement = await manager.getRepository(DriverSettlement).save({
        ...(existing ?? {}),
        driverId,
        weekStart: startDate,
        weekEnd: endDate,
        total,
        status: 'paid',
        paidAt: new Date(),
        paidByUserId: actorId,
        updatedAt: new Date(),
      });
      if (trips.length)
        await manager.getRepository(Viajes).update(
          trips.map((trip) => trip.id),
          { driverSettlementId: settlement.id },
        );
      if (multas.length)
        await manager.query(
          `UPDATE disciplinary_sanctions SET driver_settlement_id = $1 WHERE id = ANY($2::uuid[])`,
          [settlement.id, multas.map((multa) => multa.id)],
        );
      return settlement;
    });

    /*
     * Nivel 2: es dinero suyo, y hasta ahora se enteraba mirando el portal por
     * su cuenta. En su propio try/catch, que la liquidacion ya esta cerrada.
     */
    const chofer = await this.drivers.findOne({
      where: { id: driverId },
      select: { id: true, usuarioId: true },
    });
    const usuarioId = chofer?.usuarioId;
    if (usuarioId) {
      try {
        await this.notifications.notificar(usuarioId, {
          titulo: 'Tu liquidación está lista',
          cuerpo: 'Toca para ver el detalle de tu pago.',
          url: '/chofer/portal',
          tag: `liquidacion-${resultado.id}`,
          tipo: AVISO_LIQUIDACION,
        });
      } catch (err) {
        this.logger.error(
          'Error enviando el aviso push de la liquidación:',
          err,
        );
      }
    }

    return resultado;
  }

  /**
   * Lo que se le paga a un chofer en una semana abierta: sus viajes terminados que
   * aun no estan en ningun corte, menos sus multas por descontar.
   *
   * Un viaje que termina cuando el corte de su semana ya estaba pagado no se
   * pierde: queda sin corte y este lo recoge en la semana siguiente que se cierre.
   * Los de una semana anterior que sigue sin pagar no se tocan, son de su propio
   * corte.
   *
   * Las multas se descuentan enteras, de la mas antigua a la mas nueva, mientras
   * quepan en lo ganado: el pago nunca queda negativo y la que no cabe espera al
   * corte siguiente.
   */
  private async corteDelChofer(
    manager: EntityManager,
    driverId: string,
    weekStart: string,
    weekEnd: string,
    bloquear = false,
  ) {
    const { desde, hasta } = this.limitesDeSemana(weekStart, weekEnd);
    const consulta = manager
      .getRepository(Viajes)
      .createQueryBuilder('v')
      .where('v.choferId = :driverId', { driverId })
      .andWhere("v.proveedorTransporte = 'interno'")
      .andWhere("v.estado = 'finalizado'")
      .andWhere('v.driverSettlementId IS NULL')
      .andWhere('v.horaFinViaje <= :hasta', { hasta })
      .andWhere(
        `(v.horaFinViaje >= :desde OR EXISTS (
          SELECT 1 FROM driver_settlements d
          WHERE d.driver_id = :driverId AND d.status = 'paid'
            AND (v.hora_fin_viaje AT TIME ZONE 'America/Mexico_City')::date
                BETWEEN d.week_start AND d.week_end))`,
        { desde },
      );
    if (bloquear) consulta.setLock('pessimistic_write');
    const trips = await consulta.getMany();

    const candidatas: Array<{ id: string; fine_amount: string }> =
      await manager.query(
        `SELECT id, fine_amount FROM disciplinary_sanctions
          WHERE subject_type = 'driver' AND subject_id = $1 AND type = 'fine'
            AND status = 'active' AND driver_settlement_id IS NULL
            AND created_at <= $2
          ORDER BY created_at, id`,
        [driverId, hasta],
      );

    let restante = toCents(sumMoney(trips.map((trip) => trip.driverPayout)));
    const multas: Array<{ id: string; amount: number }> = [];
    for (const multa of candidatas) {
      const centavos = toCents(Number(multa.fine_amount));
      if (centavos > restante) break;
      restante -= centavos;
      multas.push({ id: multa.id, amount: Number(multa.fine_amount) });
    }
    return { trips, multas, total: fromCents(restante) };
  }

  async syncDriverSettlement(tripId: string): Promise<void> {
    const trip = await this.trips.findOneBy({ id: tripId });
    if (
      !trip ||
      trip.proveedorTransporte !== 'interno' ||
      trip.estado !== 'finalizado' ||
      !trip.choferId ||
      !trip.horaFinViaje
    ) {
      return;
    }
    // Si el corte de su semana ya esta pagado, el viaje cuenta en la primera
    // semana siguiente que siga abierta.
    let { weekStart, weekEnd } = this.getWeekBounds(trip.horaFinViaje);
    let existing = await this.driverSettlements.findOneBy({
      driverId: trip.choferId,
      weekStart,
    });
    while (existing?.status === 'paid') {
      const siguiente = new Date(`${weekStart}T12:00:00.000Z`);
      siguiente.setUTCDate(siguiente.getUTCDate() + 7);
      ({ weekStart, weekEnd } = this.getWeekBounds(siguiente));
      existing = await this.driverSettlements.findOneBy({
        driverId: trip.choferId,
        weekStart,
      });
    }
    const { total } = await this.corteDelChofer(
      this.dataSource.manager,
      trip.choferId,
      weekStart,
      weekEnd,
    );
    await this.driverSettlements.save({
      ...(existing ?? {}),
      driverId: trip.choferId,
      weekStart,
      weekEnd,
      total,
      status: 'pending',
      updatedAt: new Date(),
    });
  }

  async getActiveDrivers(startDate: string, endDate: string) {
    const trips = await this.trips.find({
      where: {
        proveedorTransporte: 'interno',
        estado: 'finalizado',
        horaFinViaje: this.ventanaDeSemana(startDate, endDate),
      },
    });
    const driverIds = [
      ...new Set(
        trips.map((trip) => trip.choferId).filter((id): id is string => !!id),
      ),
    ];
    if (!driverIds.length) return [];
    const drivers = await this.drivers.findBy({ id: In(driverIds) });
    return drivers.map((driver) => ({ id: driver.id, name: driver.nombre }));
  }

  async getDriverReport(driverId: string, startDate: string, endDate: string) {
    const driver = await this.drivers.findOneBy({ id: driverId });
    if (!driver) throw new NotFoundException('Chofer no encontrado');
    const existing = await this.driverSettlements.findOneBy({
      driverId,
      weekStart: startDate,
    });
    // Un corte pagado muestra lo que de verdad liquido (incluye viajes de
    // semanas anteriores que se recogieron y las multas que descontó); uno
    // abierto, lo que se pagaria hoy.
    const pagado = existing?.status === 'paid';
    const corte = pagado
      ? null
      : await this.corteDelChofer(
          this.dataSource.manager,
          driverId,
          startDate,
          endDate,
        );
    const trips = pagado
      ? await this.trips.find({
          where: { driverSettlementId: existing.id },
          order: { horaFinViaje: 'ASC' },
        })
      : [...corte!.trips].sort(
          (a, b) =>
            (a.horaFinViaje?.getTime() ?? 0) - (b.horaFinViaje?.getTime() ?? 0),
        );
    const multas: Array<{ id: string; reason: string; amount: number }> = (
      await this.dataSource.query(
        `SELECT id, reason, fine_amount FROM disciplinary_sanctions
          WHERE subject_type = 'driver' AND subject_id = $1 AND type = 'fine'
            AND ${pagado ? 'driver_settlement_id = $2' : 'id = ANY($2::uuid[])'}
          ORDER BY created_at`,
        [driverId, pagado ? existing.id : corte!.multas.map((m) => m.id)],
      )
    ).map((m: { id: string; reason: string; fine_amount: string }) => ({
      id: m.id,
      reason: m.reason,
      amount: Number(m.fine_amount),
    }));
    const totalPay = pagado ? Number(existing.total) : corte!.total;
    return {
      fines: multas,
      finesTotal: sumMoney(multas.map((m) => m.amount)),
      driver: { id: driver.id, name: driver.nombre },
      period: { startDate, endDate },
      trips: trips.map((trip) => ({
        id: trip.id,
        tipo: trip.tipo,
        zona: trip.zona,
        driverPayout: Number(trip.driverPayout),
        horaFinViaje: trip.horaFinViaje,
      })),
      weeklySettlement: {
        status: existing ? existing.status : ('preview' as const),
        totalPay,
        confirmedAt: existing?.paidAt ?? null,
      },
    };
  }
}
