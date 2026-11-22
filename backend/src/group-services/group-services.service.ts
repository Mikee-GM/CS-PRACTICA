import {
  BadRequestException,
  ConflictException,
  forwardRef,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { Choferes } from '../drivers/entities/driver.entity';
import { Clientes } from '../clients/entities/client.entity';
import { DisciplineService } from '../discipline/discipline.service';
import { Empleadas } from '../employees/entities/employee.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentReceiptValidations } from '../services/entities/payment-receipt-validation.entity';
import { Servicios } from '../services/entities/service.entity';
import { TransportSetting } from '../transport-operations/entities/transport-setting.entity';
import { PresetServiceLocation } from '../transport-operations/entities/preset-service-location.entity';
import { EmployeeCashObligation } from '../transport-operations/entities/employee-cash-obligation.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { Usuarios } from '../users/entities/user.entity';
import {
  AddGroupParticipantDto,
  ChangeGroupDurationDto,
  ChangeGroupResponsibleDto,
  ConfigureGroupTransportDto,
  ConfirmGroupQuoteDto,
  CreateGroupRequestDto,
  ManualTransportChargeDto,
  RegisterGroupPaymentDto,
  RemoveGroupParticipantDto,
  ReserveGroupSelectionDto,
  UpdateGroupRequestDto,
} from './dto/group-service.dto';
import { GroupServiceRequest } from './entities/group-service-request.entity';
import { GroupServiceRequestSelection } from './entities/group-service-request-selection.entity';
import { ServiceGroupAudit } from './entities/service-group-audit.entity';
import { ServiceParticipant } from './entities/service-participant.entity';
import { ServicePayment } from './entities/service-payment.entity';
import { TripPassenger } from './entities/trip-passenger.entity';
import { ConfigService } from '@nestjs/config';
import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
} from '../common/scheduling/advisory-lock';
import { describeError } from '../common/errors/error-message';
import { OfficeLiquidationSyncService } from '../liquidations/office-liquidation-sync.service';
import { ServicesService } from '../services/services.service';
import { GroupBossAssignmentService } from './group-boss-assignment.service';
import {
  GrupoEnChatWebService,
  type MensajeDelGrupo,
  type PedidoGrupalDelChat,
} from './grupo-en-chat-web.service';

type Actor = Pick<Usuarios, 'id' | 'rol'>;

@Injectable()
export class GroupServicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GroupServicesService.name);
  private static readonly HOLD_MS = 30 * 60 * 1000;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GroupServiceRequest)
    private readonly requests: Repository<GroupServiceRequest>,
    @InjectRepository(GroupServiceRequestSelection)
    private readonly selections: Repository<GroupServiceRequestSelection>,
    @InjectRepository(ServiceParticipant)
    private readonly participants: Repository<ServiceParticipant>,
    @InjectRepository(ServicePayment)
    private readonly payments: Repository<ServicePayment>,
    @InjectRepository(ServiceGroupAudit)
    private readonly auditRepository: Repository<ServiceGroupAudit>,
    @InjectRepository(Servicios)
    private readonly services: Repository<Servicios>,
    @InjectRepository(Empleadas)
    private readonly employees: Repository<Empleadas>,
    @InjectRepository(Viajes)
    private readonly trips: Repository<Viajes>,
    private readonly discipline: DisciplineService,
    private readonly realtime: RealtimeEventsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly liquidationSync: OfficeLiquidationSyncService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly bossAssignment: GroupBossAssignmentService,
    private readonly grupoWeb: GrupoEnChatWebService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => void this.cicloDeLiberacion(),
      60_000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /**
   * Una pasada del temporizador. Con dos replicas cada una liberaba las mismas
   * reservas y el jefe recibia el aviso por duplicado; y sin el `catch` un
   * fallo de base de datos era un rechazo sin atender que tumbaba el proceso.
   */
  private async cicloDeLiberacion(): Promise<void> {
    try {
      await withAdvisoryLock(
        this.dataSource,
        ADVISORY_LOCKS.groupHoldRelease,
        () => this.releaseExpiredHolds(),
      );
    } catch (error) {
      this.logger.error(
        `Error liberando reservas de grupo vencidas: ${describeError(error)}`,
      );
    }
  }

  async create(dto: CreateGroupRequestDto, actor: Actor) {
    if (!['jefe', 'admin'].includes(actor.rol)) {
      throw new ForbiddenException('No puedes crear solicitudes grupales');
    }
    const bossId =
      actor.rol === 'jefe'
        ? actor.id
        : await this.bossAssignment.resolve(dto.initialEmployeeId, actor.id);
    return this.createRequest(dto, bossId);
  }

  /**
   * Solicitud grupal desde una conversacion del chat web (decision 6 de la
   * Fase 5). La crea el jefe: el turno de la IA solo entrega la conversacion
   * al equipo cuando el cliente pide varias chicas. La conversacion pasa a
   * manos de quien organiza, para que la IA no conteste mientras se arma el
   * grupo, y desde ahi todo lo que se le dice al cliente sale por ese chat.
   */
  async createFromConversation(conversationId: string, actor: Actor) {
    if (!['jefe', 'admin'].includes(actor.rol)) {
      throw new ForbiddenException('No puedes crear solicitudes grupales');
    }
    const conversation = await this.grupoWeb.conversacionParaGrupo(
      conversationId,
      actor,
    );
    // Un cliente solo tiene una solicitud viva. Si ya la organiza otro jefe,
    // devolverla aqui le daria a este una solicitud que no puede tocar.
    const enCurso = await this.requests.findOne({
      where: {
        clientId: conversation.clientId,
        status: In([
          'esperando_jefe',
          'seleccionando',
          'reservada',
          'esperando_pago',
        ]),
      },
      select: { id: true, bossId: true },
    });
    if (enCurso && actor.rol !== 'admin' && enCurso.bossId !== actor.id) {
      throw new ConflictException(
        'El cliente ya tiene una solicitud grupal en curso con otro jefe',
      );
    }
    const bossId =
      actor.rol === 'jefe'
        ? actor.id
        : (enCurso?.bossId ??
          (await this.bossAssignment.resolve(
            conversation.employeeId,
            actor.id,
          )));
    const request = await this.createRequest(
      {
        clientId: conversation.clientId,
        initialEmployeeId: conversation.employeeId,
      },
      bossId,
      conversation.id,
    );
    await this.grupoWeb.tomarControl(conversation, actor.id);
    return this.findOne(request.id, actor);
  }

  /** Conversaciones del chat que piden un grupo y aun no tienen solicitud. */
  pendingConversations(actor: Actor): Promise<PedidoGrupalDelChat[]> {
    if (!['jefe', 'admin'].includes(actor.rol)) {
      throw new ForbiddenException('No puedes consultar solicitudes grupales');
    }
    return this.grupoWeb.pedidosPendientes(actor);
  }

  private async createRequest(
    dto: CreateGroupRequestDto,
    bossId: string,
    conversationId: string | null = null,
  ) {
    const client = await this.dataSource
      .getRepository(Clientes)
      .findOneBy({ id: dto.clientId });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    await this.discipline.assertOperationallyAllowed('client', dto.clientId);

    const existing = await this.requests.findOne({
      where: {
        clientId: dto.clientId,
        status: In([
          'esperando_jefe',
          'seleccionando',
          'reservada',
          'esperando_pago',
        ]),
      },
      relations: { selections: { employee: true }, client: true, boss: true },
    });
    if (existing) {
      // Un cliente solo tiene una solicitud viva. Si ya la tenia (creada
      // a mano) y aun no hablaba por ningun chat web, se
      // le engancha este, para que la cotizacion le llegue donde escribe.
      if (conversationId && !existing.conversationId) {
        await this.requests.update(existing.id, { conversationId });
        existing.conversationId = conversationId;
        await this.audit(
          null,
          existing.id,
          bossId,
          'conversacion_web_enlazada',
          null,
          { conversationId },
        );
      }
      return existing;
    }

    const request = await this.requests.save(
      this.requests.create({
        clientId: dto.clientId,
        bossId,
        initialEmployeeId: dto.initialEmployeeId ?? null,
        bookingSessionId: dto.bookingSessionId ?? null,
        conversationId,
        serviceId: null,
        status: 'esperando_jefe',
        durationHours: null,
        paymentMethod: null,
        locationLat: null,
        locationLng: null,
        locationReference: null,
        holdExpiresAt: null,
        catalogVersion: 0,
        aiActive: false,
      }),
    );
    await this.audit(null, request.id, bossId, 'solicitud_creada', null, {
      initialEmployeeId: dto.initialEmployeeId ?? null,
      ...(conversationId ? { canal: 'web', conversationId } : {}),
    });
    this.realtime.emitToBoss(bossId, {
      type: 'group_service_request_created',
      data: request,
    });
    return this.findOne(request.id, { id: bossId, rol: 'jefe' });
  }

  async findAll(actor: Actor) {
    await this.releaseExpiredHolds();
    const solicitudes = await this.requests.find({
      where: actor.rol === 'admin' ? {} : { bossId: actor.id },
      relations: {
        client: { usuario: true },
        boss: true,
        initialEmployee: true,
        selections: { employee: true },
        service: {
          participantes: { employee: true },
          viajes: { passengers: { employee: true } },
          pagos: { receiptValidation: true },
          receiptValidations: true,
        },
      },
      order: { createdAt: 'DESC' },
    });
    // El nombre del cliente web vive en el usuario. Se
    // expone solo ese dato como clientNombre para no filtrar la entidad
    // Usuarios completa en la respuesta.
    return solicitudes.map(({ client, ...resto }) => ({
      ...resto,
      client: client ? { ...client, usuario: undefined } : client,
      clientNombre: client?.usuario?.nombre ?? null,
    }));
  }

  async findOne(id: string, actor: Actor) {
    await this.releaseExpiredHolds();
    const request = await this.requests.findOne({
      where: { id },
      relations: {
        client: true,
        boss: true,
        initialEmployee: true,
        selections: { employee: true },
        service: {
          cliente: true,
          participantes: { employee: { usuario: true } },
          viajes: { passengers: { employee: true }, chofer: true },
          pagos: { receiptValidation: true },
          receiptValidations: true,
        },
      },
    });
    if (!request) throw new NotFoundException('Solicitud grupal no encontrada');
    this.assertOwner(request, actor);
    return request;
  }

  async availableEmployees(actor: Actor) {
    if (!['jefe', 'admin'].includes(actor.rol)) {
      throw new ForbiddenException('No puedes consultar candidatas');
    }
    await this.releaseExpiredHolds();
    const employees = await this.employees.find({
      where: {
        disponible: true,
        catalogoActivo: true,
        // `enJornada` ademas de `activo`: una modelo que cerro su dia no debe
        // aparecer como candidata para un servicio grupal de esta noche.
        usuario: { activo: true, enJornada: true },
      },
      relations: { usuario: true, empleadaFotos: true, jefe: true },
    });
    if (!employees.length) return [];

    const ids = employees.map((employee) => employee.id);
    const conflicts = await this.dataSource.query(
      `SELECT DISTINCT employee_id
       FROM (
         SELECT employee_id
         FROM service_participants
         WHERE employee_id = ANY($1::uuid[])
           AND status IN ('reservada','pendiente_pago','activa')
           AND (hold_expires_at IS NULL OR hold_expires_at > now())
         UNION ALL
         SELECT employee_id
         FROM group_service_request_selections
         WHERE employee_id = ANY($1::uuid[])
           AND status = 'reservada' AND expires_at > now()
         UNION ALL
         SELECT empleada_id AS employee_id
         FROM servicios
         WHERE empleada_id = ANY($1::uuid[])
           AND service_type = 'individual'
           AND estado IN ('pendiente','agendado','en_curso')
         UNION ALL
         SELECT subject_id AS employee_id
         FROM disciplinary_sanctions
         WHERE subject_id = ANY($1::uuid[])
           AND subject_type = 'employee' AND status = 'active'
           AND starts_at <= now()
           AND (type = 'permanent_ban' OR ends_at > now())
       ) conflicts`,
      [ids],
    );
    const blocked = new Set<string>(
      conflicts.map((row: { employee_id: string }) => row.employee_id),
    );
    const candidates = employees.filter(
      (employee) => !blocked.has(employee.id),
    );
    return this.rankEmployeesByScore(candidates);
  }

  /**
   * Ordena candidatas por el mismo score usado en los KPIs (calificación − reportes
   * confirmados) en vez de orden alfabético, para que el jefe vea primero a las de
   * mejor desempeño al armar un servicio grupal.
   */
  private async rankEmployeesByScore(
    employees: Empleadas[],
  ): Promise<Empleadas[]> {
    if (employees.length === 0) return employees;
    const confirmedRows: Array<{ subject_id: string; confirmed: number }> =
      await this.dataSource.query(
        `SELECT subject_id, COUNT(*)::int AS confirmed
         FROM conduct_reports
         WHERE subject_type = 'employee' AND outcome = 'confirmado'
           AND created_at >= now() - interval '90 days'
           AND subject_id = ANY($1::uuid[])
         GROUP BY subject_id`,
        [employees.map((employee) => employee.id)],
      );
    const confirmedByEmployee = new Map(
      confirmedRows.map((row) => [row.subject_id, row.confirmed]),
    );
    const withScore = employees.map((employee) => {
      const rating =
        employee.promedioCalificacion != null
          ? Number(employee.promedioCalificacion)
          : 2.5;
      const confirmed = confirmedByEmployee.get(employee.id) ?? 0;
      const score = Math.max(0, Math.round((rating / 5) * 100 - confirmed * 8));
      return { employee, score };
    });
    withScore.sort(
      (a, b) =>
        b.score - a.score ||
        a.employee.nombreArtistico.localeCompare(b.employee.nombreArtistico),
    );
    return withScore.map((entry) => entry.employee);
  }

  async updateRequest(id: string, dto: UpdateGroupRequestDto, actor: Actor) {
    const request = await this.findRequestForMutation(id, actor);
    if (request.serviceId) {
      throw new ConflictException(
        'La solicitud ya generó un servicio; usa las acciones del servicio',
      );
    }
    const before = this.requestSnapshot(request);
    Object.assign(request, {
      ...(dto.durationHours !== undefined
        ? { durationHours: dto.durationHours }
        : {}),
      ...(dto.paymentMethod ? { paymentMethod: dto.paymentMethod } : {}),
      ...(dto.locationLat !== undefined
        ? { locationLat: dto.locationLat }
        : {}),
      ...(dto.locationLng !== undefined
        ? { locationLng: dto.locationLng }
        : {}),
      ...(dto.locationReference !== undefined
        ? { locationReference: dto.locationReference.trim() || null }
        : {}),
    });
    const saved = await this.requests.save(request);
    await this.audit(
      null,
      request.id,
      actor.id,
      'solicitud_actualizada',
      before,
      this.requestSnapshot(saved),
    );
    return this.findOne(id, actor);
  }

  /**
   * La conversacion con el cliente. Todo grupo nace del chat web; una solicitud
   * sin conversacion es un dato heredado y no tiene mensajes que mostrar.
   */
  async requestMessages(id: string, actor: Actor) {
    const request = await this.findOne(id, actor);
    this.assertConversacionWeb(request);
    return this.grupoWeb.mensajes(request);
  }

  async sendRequestMessage(id: string, message: string, actor: Actor) {
    const request = await this.findOne(id, actor);
    this.assertConversacionWeb(request);
    const enviado: MensajeDelGrupo = await this.grupoWeb.escribirDelJefe(
      request,
      message,
    );
    this.realtime.emitToBoss(request.bossId, {
      type: 'group_chat_message',
      data: enviado,
    });
    return enviado;
  }

  async openCatalog(id: string, actor: Actor) {
    const request = await this.findRequestForMutation(id, actor);
    if (request.serviceId)
      throw new ConflictException('La solicitud ya fue confirmada');
    // Decision 6 de la Fase 5: en el chat web el cliente no elige de un
    // catalogo con botones; las modelos las reserva el jefe desde el panel.
    throw new ConflictException(
      'El jefe elige a las modelos desde el panel; el cliente no recibe catalogo',
    );
  }

  async requestClientLocation(id: string, actor: Actor) {
    const request = await this.findOne(id, actor);
    this.assertConversacionWeb(request);
    await this.grupoWeb.pedirUbicacion(request);
    await this.audit(null, id, actor.id, 'ubicacion_solicitada', null, {
      canal: 'web',
    });
    return { sent: true };
  }

  /**
   * Todo grupo nace del chat web: sin conversacion no hay por donde hablar con
   * el cliente, y no existe otro canal al que recurrir.
   */
  private assertConversacionWeb(request: GroupServiceRequest): void {
    if (!request.conversationId)
      throw new ConflictException(
        'La solicitud no tiene conversacion en el chat web',
      );
  }

  /**
   * Usa como ubicacion del grupo el ultimo pin que el cliente mando por el
   * chat web. El pin no llega solo a la solicitud: lo
   * aplica el jefe, que es quien lo ve en la conversacion y decide si vale.
   * La cobertura no se juzga aqui, aqui.
   */
  async useChatLocation(id: string, actor: Actor) {
    const request = await this.findRequestForMutation(id, actor);
    if (request.serviceId)
      throw new ConflictException(
        'La solicitud ya generó un servicio; usa las acciones del servicio',
      );
    if (!request.conversationId)
      throw new ConflictException('La solicitud no viene del chat web');
    const pin = await this.grupoWeb.ultimaUbicacionDelCliente(
      request.conversationId,
    );
    if (!pin)
      throw new ConflictException(
        'El cliente todavía no compartió su ubicación en el chat',
      );
    const before = this.requestSnapshot(request);
    request.locationLat = pin.lat;
    request.locationLng = pin.lng;
    if (pin.address && !request.locationReference) {
      request.locationReference = pin.address.slice(0, 240);
    }
    const saved = await this.requests.save(request);
    await this.audit(null, id, actor.id, 'ubicacion_cliente_recibida', before, {
      ...this.requestSnapshot(saved),
      canal: 'web',
    });
    return this.findOne(id, actor);
  }

  async reserveSelections(
    id: string,
    dto: ReserveGroupSelectionDto,
    actor?: Actor,
  ) {
    const employeeIds = [...new Set(dto.employeeIds)];
    if (employeeIds.length < 2)
      throw new BadRequestException('Selecciona al menos dos empleadas');
    const expiresAt = new Date(Date.now() + GroupServicesService.HOLD_MS);

    await this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(GroupServiceRequest, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request)
        throw new NotFoundException('Solicitud grupal no encontrada');
      if (actor) this.assertOwner(request, actor);
      if (
        dto.catalogVersion !== undefined &&
        dto.catalogVersion !== request.catalogVersion
      ) {
        throw new ConflictException(
          'El catálogo cambió; vuelve a abrirlo antes de confirmar',
        );
      }
      if (
        request.serviceId ||
        ['cancelada', 'vencida'].includes(request.status)
      )
        throw new ConflictException('La solicitud ya no admite selecciones');

      /*
       * Sin join en la consulta bloqueada: PostgreSQL no permite FOR UPDATE en
       * el lado nulo de un outer join, y `leftJoinAndSelect('employee.usuario')`
       * generaba exactamente eso. Reventaba con "FOR UPDATE cannot be applied
       * to nullable side of an outer join" cada vez que un cliente confirmaba
       * su selección de un servicio grupal. El mismo remedio ya se aplicó antes
       * en `services.service.ts` para un caso identico.
       */
      const employees = await manager
        .getRepository(Empleadas)
        .createQueryBuilder('employee')
        .setLock('pessimistic_write')
        .where('employee.id IN (:...employeeIds)', { employeeIds })
        .getMany();
      if (employees.length !== employeeIds.length)
        throw new BadRequestException('Una o más empleadas no existen');

      const usuarios = await manager.find(Usuarios, {
        where: { id: In(employees.map((employee) => employee.usuarioId)) },
      });
      const usuarioPorId = new Map(
        usuarios.map((usuario) => [usuario.id, usuario]),
      );
      for (const employee of employees) {
        const usuario = usuarioPorId.get(employee.usuarioId);
        if (
          !employee.disponible ||
          !employee.catalogoActivo ||
          !usuario?.activo
        ) {
          throw new ConflictException(
            `${employee.nombreArtistico} ya no está disponible`,
          );
        }
        await this.assertEmployeeFree(manager, employee.id, id);
      }

      await manager.update(
        GroupServiceRequestSelection,
        {
          requestId: id,
          employeeId: Not(In(employeeIds)),
          status: In(['seleccionada', 'reservada']),
        },
        { status: 'liberada' },
      );
      for (const employee of employees) {
        await manager.upsert(
          GroupServiceRequestSelection,
          {
            requestId: id,
            employeeId: employee.id,
            status: 'reservada',
            selectedBy: dto.selectedBy ?? (actor ? 'jefe' : 'cliente'),
            hourlyRateSnapshot: Number(employee.precioBaseHora),
            expiresAt,
          },
          ['requestId', 'employeeId'],
        );
      }
      request.status = 'reservada';
      request.holdExpiresAt = expiresAt;
      await manager.save(GroupServiceRequest, request);
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          requestId: id,
          serviceId: null,
          actorUserId: actor?.id ?? null,
          action: 'seleccion_reservada',
          before: null,
          after: { employeeIds, expiresAt: expiresAt.toISOString() },
          reason: null,
        }),
      );
    });
    return this.findOne(
      id,
      actor ?? {
        id: (await this.requests.findOneByOrFail({ id })).bossId,
        rol: 'jefe',
      },
    );
  }

  async extendHold(id: string, actor: Actor) {
    const request = await this.findRequestForMutation(id, actor);
    if (request.serviceId)
      throw new ConflictException('La solicitud ya fue confirmada');
    const expiresAt = new Date(Date.now() + GroupServicesService.HOLD_MS);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        GroupServiceRequestSelection,
        { requestId: id, status: 'reservada' },
        { expiresAt },
      );
      request.holdExpiresAt = expiresAt;
      if (request.status === 'vencida') request.status = 'reservada';
      await manager.save(GroupServiceRequest, request);
    });
    await this.audit(null, id, actor.id, 'reserva_extendida', null, {
      expiresAt: expiresAt.toISOString(),
    });
    return this.findOne(id, actor);
  }

  async confirmQuote(id: string, dto: ConfirmGroupQuoteDto, actor: Actor) {
    const { serviceId, conversationId } = await this.dataSource.transaction(
      async (manager) => {
        const request = await manager.findOne(GroupServiceRequest, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!request)
          throw new NotFoundException('Solicitud grupal no encontrada');
        this.assertOwner(request, actor);
        if (request.serviceId)
          throw new ConflictException('La cotización ya fue confirmada');
        this.assertRequestComplete(request);

        const selections = await manager.find(GroupServiceRequestSelection, {
          where: {
            requestId: id,
            status: 'reservada',
            expiresAt: MoreThan(new Date()),
          },
          relations: { employee: true },
        });
        if (selections.length < 2)
          throw new ConflictException(
            'Se necesitan al menos dos reservas vigentes',
          );
        if (
          !selections.some(
            (selection) => selection.employeeId === dto.responsibleEmployeeId,
          )
        ) {
          throw new BadRequestException(
            'La responsable debe pertenecer a la selección',
          );
        }
        this.validateTransportUnits(
          dto,
          selections.map((selection) => selection.employeeId),
        );
        for (const selection of selections) {
          await this.assertEmployeeFree(manager, selection.employeeId, id);
        }

        const setting = await manager.findOneBy(TransportSetting, { id: 1 });
        const presetLocations = await manager.find(PresetServiceLocation, {
          where: { active: true },
        });
        const presetLocation = presetLocations.find(
          (location) =>
            Math.abs(Number(location.latitude) - Number(request.locationLat)) <
              0.000001 &&
            Math.abs(Number(location.longitude) - Number(request.locationLng)) <
              0.000001,
        );
        const fee = presetLocation
          ? 0
          : Number(setting?.externalLocationFee ?? 0);
        const internalDriverPayout = presetLocation ? 60 : fee / 2;
        const vehicleCount = this.billableVehicleCount(dto.transportUnits);
        const customerTransportCharge = fee * vehicleCount;
        const responsible = selections.find(
          (item) => item.employeeId === dto.responsibleEmployeeId,
        )!;
        const requiresPayment = request.paymentMethod === 'transferencia';
        const service = await manager.save(
          Servicios,
          manager.create(Servicios, {
            serviceType: 'grupal',
            empleadaId: responsible.employeeId,
            clienteId: request.clientId,
            jefeId: request.bossId,
            metodoPago: request.paymentMethod!,
            duracionPactadaHoras: Number(request.durationHours),
            duracionFinalHoras: null,
            ubicacionClienteLat: Number(request.locationLat),
            ubicacionClienteLng: Number(request.locationLng),
            presetLocationId: presetLocation?.id ?? null,
            locationNameSnapshot: presetLocation?.name ?? null,
            locationAddressSnapshot:
              presetLocation?.address ?? request.locationReference ?? null,
            precioBaseHoraPactado: Number(responsible.hourlyRateSnapshot),
            totalBase: 0,
            totalExtras: 0,
            totalFinal: 0,
            totalPaid: 0,
            pendingBalance: 0,
            totalTransporte: customerTransportCharge,
            customerTransportCharge,
            transportFeeSnapshot: fee,
            manualTransportAdjustment: 0,
            actualTransportCost: 0,
            estado: 'pendiente',
            estadoLiquidacion: 'cerrada',
            iaActiva: false,
          }),
        );

        const holdExpiresAt = new Date(
          Date.now() + GroupServicesService.HOLD_MS,
        );
        for (const selection of selections) {
          await manager.save(
            ServiceParticipant,
            manager.create(ServiceParticipant, {
              serviceId: service.id,
              employeeId: selection.employeeId,
              role:
                selection.employeeId === dto.responsibleEmployeeId
                  ? 'responsable'
                  : 'participante',
              status: requiresPayment ? 'pendiente_pago' : 'reservada',
              hourlyRateSnapshot: Number(selection.hourlyRateSnapshot),
              billableHours: Number(request.durationHours),
              confirmedSubtotal:
                Number(selection.hourlyRateSnapshot) *
                Number(request.durationHours),
              holdExpiresAt,
              joinedAt: null,
              removedAt: null,
            }),
          );
        }

        for (const unit of dto.transportUnits) {
          const provider = unit.provider === 'chofer' ? 'interno' : 'uber';
          const trip = await manager.save(
            Viajes,
            manager.create(Viajes, {
              servicioId: service.id,
              choferId: null,
              tipo: unit.direction,
              unitNumber: unit.unitNumber,
              zona: 'domicilio',
              tarifa: provider === 'interno' ? internalDriverPayout : 0,
              driverPayout: provider === 'interno' ? internalDriverPayout : 0,
              estado: provider === 'interno' ? 'notificado' : 'aceptado',
              proveedorTransporte: provider,
            }),
          );
          await manager.save(
            TripPassenger,
            unit.employeeIds.map((employeeId) =>
              manager.create(TripPassenger, { tripId: trip.id, employeeId }),
            ),
          );
        }

        await manager.update(
          GroupServiceRequestSelection,
          { requestId: id, status: 'reservada' },
          { status: 'confirmada', expiresAt: holdExpiresAt },
        );
        request.serviceId = service.id;
        request.status = requiresPayment ? 'esperando_pago' : 'confirmada';
        request.holdExpiresAt = holdExpiresAt;
        await manager.save(GroupServiceRequest, request);
        if (request.conversationId) {
          await this.grupoWeb.enlazarServicio(
            manager,
            request.conversationId,
            service.id,
          );
        }
        await manager.save(
          ServiceGroupAudit,
          manager.create(ServiceGroupAudit, {
            serviceId: service.id,
            requestId: id,
            actorUserId: actor.id,
            action: 'cotizacion_confirmada',
            before: null,
            after: {
              responsibleEmployeeId: dto.responsibleEmployeeId,
              employeeIds: selections.map((item) => item.employeeId),
              durationHours: request.durationHours,
              vehicleCount,
              customerTransportCharge,
            },
            reason: null,
          }),
        );
        return {
          serviceId: service.id,
          conversationId: request.conversationId,
        };
      },
    );
    this.realtime.emitToBoss(actor.id, {
      type: 'group_quote_confirmed',
      data: { requestId: id, serviceId },
    });
    const result = await this.findService(serviceId, actor);
    // En la web la cotizacion entera, saldo y cuentas incluidos: es lo
    // primero que el cliente sabe del grupo que se le armo.
    await this.grupoWeb.avisarCotizacion({ conversationId }, result);
    return result;
  }

  async registerPayment(
    serviceId: string,
    dto: RegisterGroupPaymentDto,
    actor: Actor,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const service = await this.lockGroupService(manager, serviceId, actor);
      if (service.metodoPago === 'transferencia' && !dto.receiptValidationId) {
        throw new ConflictException(
          'La transferencia requiere un CEP confirmado',
        );
      }
      let receipt: PaymentReceiptValidations | null = null;
      if (dto.receiptValidationId) {
        receipt = await manager.findOneBy(PaymentReceiptValidations, {
          id: dto.receiptValidationId,
        });
        if (!receipt)
          throw new NotFoundException(
            'Validación de comprobante no encontrada',
          );
        if (receipt.servicioId !== serviceId)
          throw new ConflictException('El CEP pertenece a otro servicio');
        if (receipt.estado === 'PAGO_REGISTRADO')
          throw new ConflictException(
            'Este comprobante ya se aplicó al servicio',
          );
        if (
          !receipt.pagoConfirmadoAt ||
          receipt.pagoConfirmacionFuente !== 'cep'
        ) {
          throw new ConflictException('El pago requiere confirmación con CEP');
        }
        if (Math.abs(Number(receipt.monto) - Number(dto.amount)) > 0.009)
          throw new ConflictException(
            'El monto del pago no coincide con el CEP confirmado',
          );
      }
      const fingerprint = receipt
        ? this.receiptFingerprint(receipt)
        : dto.fingerprint?.trim() || null;
      try {
        await manager.save(
          ServicePayment,
          manager.create(ServicePayment, {
            serviceId,
            receiptValidationId: receipt?.id ?? null,
            approvedByUserId: actor.id,
            amount: dto.amount,
            status: 'aprobado',
            fingerprint,
            notes: dto.notes?.trim() || null,
          }),
        );
      } catch (error: any) {
        if (error?.code === '23505') {
          throw new ConflictException(
            'Este comprobante ya fue utilizado en otro pago',
          );
        }
        throw error;
      }
      if (receipt) {
        receipt.estado = 'PAGO_REGISTRADO';
        await manager.save(PaymentReceiptValidations, receipt);
      }
      await manager.query(
        `UPDATE servicios SET total_paid = total_paid WHERE id = $1`,
        [serviceId],
      );
      const refreshed = await manager.findOneByOrFail(Servicios, {
        id: serviceId,
      });
      if (Number(refreshed.pendingBalance) <= 0.009) {
        await this.applyPaidPendingChanges(manager, refreshed);
      }
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action: 'pago_aprobado',
          before: null,
          after: { amount: dto.amount, fingerprint },
          reason: null,
        }),
      );
    });
    const result = await this.findService(serviceId, actor);
    if (result.estado === 'en_curso' && Number(result.pendingBalance) <= 0.009)
      await this.dispatchPendingTrips(result);
    await this.notifyPendingTransfer(result, { pagoRegistrado: true });
    return result;
  }

  async reviewReceipt(
    validationId: string,
    decision: 'aprobado' | 'rechazado',
    actor: Actor,
    reason?: string,
  ) {
    let serviceId = '';
    await this.dataSource.transaction(async (manager) => {
      const validation = await manager.findOneBy(PaymentReceiptValidations, {
        id: validationId,
      });
      if (!validation) throw new NotFoundException('Comprobante no encontrado');
      if (validation.estado !== 'PENDIENTE_REVISION')
        throw new ConflictException('Este comprobante ya fue resuelto');
      if (!validation.servicioId)
        throw new ConflictException(
          'Este comprobante no está asociado a un servicio grupal',
        );
      serviceId = validation.servicioId;
      await this.lockGroupService(manager, serviceId, actor);
      validation.revisadoPorUserId = actor.id;
      validation.revisadoAt = new Date();
      validation.estado = decision === 'aprobado' ? 'APROBADO' : 'RECHAZADO';
      await manager.save(PaymentReceiptValidations, validation);
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action:
            decision === 'aprobado'
              ? 'comprobante_revisado_aprobado'
              : 'comprobante_revisado_rechazado',
          before: { estado: 'PENDIENTE_REVISION' },
          after: { estado: validation.estado },
          reason: reason ?? null,
        }),
      );
    });

    const result = await this.findService(serviceId, actor);
    if (decision === 'rechazado') {
      // Aviso al chat web del cliente; el origen decide si hay chat.
      await this.grupoWeb.avisarComprobanteRechazado(
        await this.origenWeb(serviceId),
        reason,
      );
    }
    return result;
  }

  async start(serviceId: string, actor: Actor) {
    await this.dataSource.transaction(async (manager) => {
      const service = await this.lockGroupService(manager, serviceId, actor);
      if (service.estado !== 'pendiente')
        throw new ConflictException('El servicio ya no está pendiente');
      if (
        service.metodoPago === 'transferencia' &&
        Number(service.pendingBalance) > 0.009
      ) {
        throw new ConflictException('El servicio tiene saldo pendiente');
      }
      const participants = await manager.find(ServiceParticipant, {
        where: {
          serviceId,
          status: In(['reservada', 'pendiente_pago']),
        },
      });
      if (participants.length < 2)
        throw new ConflictException('El grupo ya no tiene dos participantes');
      if (
        !participants.some((participant) => participant.role === 'responsable')
      )
        throw new ConflictException('El grupo no tiene responsable');

      const now = new Date();
      for (const participant of participants) {
        await this.assertEmployeeFree(
          manager,
          participant.employeeId,
          null,
          serviceId,
        );
        participant.status = 'activa';
        participant.joinedAt = now;
        participant.holdExpiresAt = null;
      }
      await manager.save(ServiceParticipant, participants);
      await manager.update(
        Empleadas,
        { id: In(participants.map((item) => item.employeeId)) },
        { disponible: false },
      );
      service.estado = 'en_curso';
      service.horaInicioServicio = now;
      service.estadoLiquidacion = 'cerrada';
      await manager.save(Servicios, service);
      await manager.update(
        GroupServiceRequest,
        { serviceId },
        { status: 'confirmada', holdExpiresAt: null },
      );
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action: 'servicio_iniciado',
          before: null,
          after: { participantIds: participants.map((item) => item.id) },
          reason: null,
        }),
      );
    });
    const result = await this.findService(serviceId, actor);
    await this.dispatchPendingTrips(result);
    for (const participant of result.participantes) {
      this.realtime.emitToEmployee(participant.employeeId, {
        type: 'group_service_started',
        data: {
          serviceId,
          role: participant.role,
        },
      });
      this.notifyExternalBoss(result.jefeId, participant.employee);
      await this.avisarInicioALaParticipante(serviceId, participant);
    }
    return result;
  }

  async addParticipant(
    serviceId: string,
    dto: AddGroupParticipantDto,
    actor: Actor,
  ) {
    await this.discipline.assertOperationallyAllowed(
      'employee',
      dto.employeeId,
    );
    const dispatchTripId = await this.dataSource.transaction(
      async (manager) => {
        let newInternalTripId: string | null = null;
        const service = await this.lockGroupService(manager, serviceId, actor);
        if (!['pendiente', 'en_curso'].includes(service.estado))
          throw new ConflictException('El servicio ya no admite participantes');
        if (
          service.metodoPago === 'transferencia' &&
          Number(service.pendingBalance) > 0.009
        )
          throw new ConflictException(
            'Resuelve el saldo pendiente antes de otro cambio',
          );
        // Mismo remedio que en reserveSelections: sin join en la consulta
        // bloqueada, porque PostgreSQL no permite FOR UPDATE en el lado nulo
        // de un outer join.
        const employee = await manager
          .getRepository(Empleadas)
          .createQueryBuilder('employee')
          .setLock('pessimistic_write')
          .where('employee.id = :employeeId', { employeeId: dto.employeeId })
          .getOne();
        const usuario = employee
          ? await manager.findOneBy(Usuarios, { id: employee.usuarioId })
          : null;
        if (
          !employee ||
          !employee.disponible ||
          !employee.catalogoActivo ||
          !usuario?.activo
        )
          throw new ConflictException('La empleada no está disponible');
        await this.assertEmployeeFree(manager, employee.id, null, serviceId);

        const existing = await manager.findOneBy(ServiceParticipant, {
          serviceId,
          employeeId: employee.id,
        });
        if (existing && existing.status !== 'cancelada')
          throw new ConflictException('La empleada ya pertenece al servicio');

        const elapsed =
          service.estado === 'en_curso' && service.horaInicioServicio
            ? (Date.now() - service.horaInicioServicio.getTime()) / 3_600_000
            : 0;
        const remainingHours = Math.max(
          0,
          Number(service.duracionPactadaHoras) - elapsed,
        );
        if (remainingHours < 0.25)
          throw new ConflictException(
            'No quedan horas suficientes para incorporarla',
          );
        const requiresPayment = service.metodoPago === 'transferencia';
        const holdExpiresAt = new Date(
          Date.now() + GroupServicesService.HOLD_MS,
        );
        const participant = manager.create(ServiceParticipant, {
          ...(existing ? { id: existing.id } : {}),
          serviceId,
          employeeId: employee.id,
          role: 'participante',
          status: requiresPayment
            ? 'pendiente_pago'
            : service.estado === 'en_curso'
              ? 'activa'
              : 'reservada',
          hourlyRateSnapshot: Number(employee.precioBaseHora),
          billableHours: Number(remainingHours.toFixed(2)),
          confirmedSubtotal: Number(
            (Number(employee.precioBaseHora) * remainingHours).toFixed(2),
          ),
          holdExpiresAt: requiresPayment ? holdExpiresAt : null,
          joinedAt:
            !requiresPayment && service.estado === 'en_curso'
              ? new Date()
              : null,
          removedAt: null,
        });
        await manager.save(ServiceParticipant, participant);

        if (dto.needsNewTransport) {
          const maxUnitRow = await manager
            .getRepository(Viajes)
            .createQueryBuilder('trip')
            .select('COALESCE(MAX(trip.unitNumber), 0)', 'max')
            .where('trip.servicioId = :serviceId', { serviceId })
            .andWhere('trip.tipo = :type', { type: 'ida' })
            .getRawOne<{ max: string }>();
          const unitNumber = Number(maxUnitRow?.max ?? 0) + 1;
          const provider =
            dto.transportProvider === 'uber' ? 'uber' : 'interno';
          const trip = await manager.save(
            Viajes,
            manager.create(Viajes, {
              servicioId: serviceId,
              choferId: null,
              tipo: 'ida',
              unitNumber,
              zona: 'domicilio',
              tarifa:
                provider === 'interno'
                  ? service.presetLocationId
                    ? 60
                    : Number(service.transportFeeSnapshot) / 2
                  : 0,
              driverPayout:
                provider === 'interno'
                  ? service.presetLocationId
                    ? 60
                    : Number(service.transportFeeSnapshot) / 2
                  : 0,
              estado: provider === 'interno' ? 'notificado' : 'aceptado',
              proveedorTransporte: provider,
            }),
          );
          await manager.save(
            TripPassenger,
            manager.create(TripPassenger, {
              tripId: trip.id,
              employeeId: employee.id,
            }),
          );
          if (provider === 'interno') newInternalTripId = trip.id;
          await this.recalculateTransportCharge(manager, service);
        }
        if (!requiresPayment && service.estado === 'en_curso')
          await manager.update(Empleadas, employee.id, { disponible: false });
        await manager.save(
          ServiceGroupAudit,
          manager.create(ServiceGroupAudit, {
            serviceId,
            requestId: null,
            actorUserId: actor.id,
            action: 'participante_agregada',
            before: null,
            after: {
              employeeId: employee.id,
              remainingHours: participant.billableHours,
              subtotal: participant.confirmedSubtotal,
              status: participant.status,
              needsNewTransport: Boolean(dto.needsNewTransport),
            },
            reason: null,
          }),
        );
        return newInternalTripId;
      },
    );
    const result = await this.findService(serviceId, actor);
    if (
      dispatchTripId &&
      result.estado === 'en_curso' &&
      Number(result.pendingBalance) <= 0.009
    )
      await this.servicesService.dispatchViaje(dispatchTripId);
    await this.notifyPendingTransfer(result);
    return result;
  }

  async removeParticipant(
    serviceId: string,
    employeeId: string,
    dto: RemoveGroupParticipantDto,
    actor: Actor,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const service = await this.lockGroupService(manager, serviceId, actor);
      const participant = await manager.findOneBy(ServiceParticipant, {
        serviceId,
        employeeId,
      });
      if (
        !participant ||
        ['retirada', 'cancelada'].includes(participant.status)
      )
        throw new NotFoundException('Participante activa no encontrada');
      if (participant.role === 'responsable')
        throw new ConflictException(
          'Reemplaza a la responsable antes de retirarla',
        );
      const activeCount = await manager.count(ServiceParticipant, {
        where: {
          serviceId,
          status: In(['reservada', 'pendiente_pago', 'activa']),
        },
      });
      if (activeCount <= 2)
        throw new ConflictException(
          'Un servicio grupal debe conservar al menos dos participantes',
        );
      const before = { ...participant };
      participant.status =
        service.estado === 'en_curso' ? 'retirada' : 'cancelada';
      participant.removedAt = new Date();
      participant.holdExpiresAt = null;
      await manager.save(ServiceParticipant, participant);
      const activeElsewhere = await manager.exists(ServiceParticipant, {
        where: {
          employeeId,
          serviceId: Not(serviceId),
          status: 'activa',
        },
      });
      if (!activeElsewhere)
        await manager.update(Empleadas, employeeId, { disponible: true });
      if (dto.manualTransportCharge) {
        service.manualTransportAdjustment =
          Number(service.manualTransportAdjustment) +
          Number(dto.manualTransportCharge);
        service.customerTransportCharge =
          Number(service.customerTransportCharge ?? 0) +
          Number(dto.manualTransportCharge);
        service.totalTransporte = Number(service.customerTransportCharge);
        await manager.save(Servicios, service);
      }
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action: 'participante_retirada',
          before,
          after: {
            status: participant.status,
            manualTransportCharge: dto.manualTransportCharge ?? 0,
          },
          reason: dto.reason,
        }),
      );
    });
    return this.findService(serviceId, actor);
  }

  async changeResponsible(
    serviceId: string,
    dto: ChangeGroupResponsibleDto,
    actor: Actor,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const service = await this.lockGroupService(manager, serviceId, actor);
      const current = await manager.findOneByOrFail(ServiceParticipant, {
        serviceId,
        role: 'responsable',
        status: Not('cancelada'),
      });
      const next = await manager.findOneBy(ServiceParticipant, {
        serviceId,
        employeeId: dto.employeeId,
        status: In(['reservada', 'pendiente_pago', 'activa']),
      });
      if (!next)
        throw new BadRequestException(
          'La nueva responsable debe ser una participante vigente',
        );
      if (current.id === next.id) return;
      current.role = 'participante';
      await manager.save(ServiceParticipant, current);
      next.role = 'responsable';
      await manager.save(ServiceParticipant, next);
      service.empleadaId = next.employeeId;
      service.precioBaseHoraPactado = Number(next.hourlyRateSnapshot);
      await manager.save(Servicios, service);
      await manager.update(
        EmployeeCashObligation,
        { serviceId, status: 'pending' },
        { employeeId: next.employeeId },
      );
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action: 'responsable_reemplazada',
          before: { employeeId: current.employeeId },
          after: { employeeId: next.employeeId },
          reason: null,
        }),
      );
    });
    return this.findService(serviceId, actor);
  }

  async changeDuration(
    serviceId: string,
    dto: ChangeGroupDurationDto,
    actor: Actor,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const service = await this.lockGroupService(manager, serviceId, actor);
      const currentHours = Number(service.duracionPactadaHoras);
      if (service.estado === 'en_curso' && dto.durationHours <= currentHours)
        throw new ConflictException(
          'Después de iniciar solamente se puede aumentar la duración',
        );
      if (service.estado !== 'en_curso' && dto.durationHours === currentHours)
        return;
      if (
        service.metodoPago === 'transferencia' &&
        Number(service.pendingBalance) > 0.009
      )
        throw new ConflictException(
          'Resuelve el saldo pendiente antes de otro cambio',
        );
      const delta = dto.durationHours - currentHours;
      const statuses =
        service.estado === 'en_curso'
          ? ['activa']
          : ['reservada', 'pendiente_pago'];
      const participants = await manager.find(ServiceParticipant, {
        where: { serviceId, status: In(statuses) },
      });
      for (const participant of participants) {
        participant.billableHours = Number(
          (Number(participant.billableHours) + delta).toFixed(2),
        );
        participant.confirmedSubtotal = Number(
          (
            Number(participant.confirmedSubtotal) +
            Number(participant.hourlyRateSnapshot) * delta
          ).toFixed(2),
        );
      }
      await manager.save(ServiceParticipant, participants);
      if (
        service.estado === 'en_curso' &&
        service.metodoPago === 'transferencia'
      ) {
        service.pendingDurationHours = dto.durationHours;
      } else {
        service.duracionPactadaHoras = dto.durationHours;
        service.pendingDurationHours = null;
      }
      await manager.save(Servicios, service);
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action: 'duracion_modificada',
          before: { durationHours: currentHours },
          after: {
            durationHours: dto.durationHours,
            pendingPayment: Boolean(service.pendingDurationHours),
          },
          reason: null,
        }),
      );
    });
    const result = await this.findService(serviceId, actor);
    await this.notifyPendingTransfer(result);
    return result;
  }

  async configureTransports(
    serviceId: string,
    dto: ConfigureGroupTransportDto,
    actor: Actor,
  ) {
    const dispatchTripIds = await this.dataSource.transaction(
      async (manager) => {
        const service = await this.lockGroupService(manager, serviceId, actor);
        if (!['pendiente', 'en_curso'].includes(service.estado))
          throw new ConflictException(
            'El servicio ya no admite cambios de transporte',
          );

        const activeParticipants = await manager.find(ServiceParticipant, {
          where: {
            serviceId,
            status: In(['reservada', 'pendiente_pago', 'activa']),
          },
        });
        const employeeIds = activeParticipants.map((item) => item.employeeId);
        this.validateTransportConfiguration(dto.transportUnits, employeeIds);

        const configuredDirections = [
          ...new Set(dto.transportUnits.map((unit) => unit.direction)),
        ];
        const existingTrips = await manager.find(Viajes, {
          where: {
            servicioId: serviceId,
            tipo: In(configuredDirections),
          },
          relations: { passengers: true },
          lock: { mode: 'pessimistic_write' },
        });
        const requestedKeys = new Set(
          dto.transportUnits.map(
            (unit) => `${unit.direction}:${unit.unitNumber}`,
          ),
        );
        const immutableStates = new Set([
          'en_camino',
          'llegado',
          'en_curso',
          'finalizado',
        ]);
        const dispatchIds: string[] = [];

        for (const trip of existingTrips) {
          const key = `${trip.tipo}:${trip.unitNumber}`;
          if (requestedKeys.has(key)) continue;
          if (immutableStates.has(trip.estado))
            throw new ConflictException(
              `La unidad ${key} ya está operando y no puede eliminarse`,
            );
          trip.estado = 'cancelado';
          await manager.save(Viajes, trip);

          /*
           * Un chofer que ya habia aceptado esta unidad queda marcado como
           * ocupado, y quitar la unidad del servicio no pasa ni por finalizar
           * ni por rechazar el viaje: sin esto se quedaria ocupado para siempre
           * y el reparto dejaria de contarlo. Solo se libera si no le queda
           * otro viaje abierto.
           */
          if (trip.choferId) {
            const abiertos = await manager.count(Viajes, {
              where: {
                choferId: trip.choferId,
                estado: Not(In(['finalizado', 'cancelado', 'rechazado'])),
              },
            });
            if (abiertos === 0) {
              await manager.update(Choferes, trip.choferId, {
                disponible: true,
              });
            }
          }
        }

        for (const unit of dto.transportUnits) {
          const provider = unit.provider === 'chofer' ? 'interno' : 'uber';
          let trip = existingTrips.find(
            (item) =>
              item.tipo === unit.direction &&
              item.unitNumber === unit.unitNumber,
          );
          if (trip && immutableStates.has(trip.estado)) {
            const currentPassengerIds = (trip.passengers ?? [])
              .map((item) => item.employeeId)
              .sort();
            const nextPassengerIds = [...unit.employeeIds].sort();
            if (
              trip.proveedorTransporte !== provider ||
              currentPassengerIds.join(',') !== nextPassengerIds.join(',')
            )
              throw new ConflictException(
                `La unidad ${unit.direction}:${unit.unitNumber} ya está operando`,
              );
            continue;
          }
          trip = await manager.save(
            Viajes,
            manager.create(Viajes, {
              ...(trip ? { id: trip.id } : {}),
              servicioId: serviceId,
              choferId: null,
              tipo: unit.direction,
              unitNumber: unit.unitNumber,
              zona: 'domicilio',
              tarifa:
                provider === 'interno'
                  ? service.presetLocationId
                    ? 60
                    : Number(service.transportFeeSnapshot) / 2
                  : 0,
              driverPayout:
                provider === 'interno'
                  ? service.presetLocationId
                    ? 60
                    : Number(service.transportFeeSnapshot) / 2
                  : 0,
              estado: provider === 'interno' ? 'notificado' : 'aceptado',
              proveedorTransporte: provider,
            }),
          );
          await manager.delete(TripPassenger, { tripId: trip.id });
          await manager.save(
            TripPassenger,
            unit.employeeIds.map((employeeId) =>
              manager.create(TripPassenger, {
                tripId: trip.id,
                employeeId,
              }),
            ),
          );
          if (provider === 'interno') dispatchIds.push(trip.id);
        }

        await this.recalculateTransportCharge(manager, service);
        await manager.save(
          ServiceGroupAudit,
          manager.create(ServiceGroupAudit, {
            serviceId,
            requestId: null,
            actorUserId: actor.id,
            action: 'transportes_configurados',
            before: {
              units: existingTrips.map((trip) => ({
                id: trip.id,
                direction: trip.tipo,
                unitNumber: trip.unitNumber,
                provider: trip.proveedorTransporte,
                employeeIds: trip.passengers?.map((item) => item.employeeId),
              })),
            },
            after: { units: dto.transportUnits },
            reason: null,
          }),
        );
        return dispatchIds;
      },
    );

    const result = await this.findService(serviceId, actor);
    if (result.estado === 'en_curso' && Number(result.pendingBalance) <= 0.009)
      await Promise.all(
        dispatchTripIds.map((tripId) =>
          this.servicesService.dispatchViaje(tripId),
        ),
      );
    await this.notifyPendingTransfer(result);
    return result;
  }

  async addManualTransportCharge(
    serviceId: string,
    dto: ManualTransportChargeDto,
    actor: Actor,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const service = await this.lockGroupService(manager, serviceId, actor);
      const before = Number(service.customerTransportCharge ?? 0);
      service.manualTransportAdjustment =
        Number(service.manualTransportAdjustment) + dto.amount;
      service.customerTransportCharge = before + dto.amount;
      service.totalTransporte = Number(service.customerTransportCharge);
      await manager.save(Servicios, service);
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId: actor.id,
          action: 'cargo_transporte_manual',
          before: { customerTransportCharge: before },
          after: {
            customerTransportCharge: service.customerTransportCharge,
            amount: dto.amount,
          },
          reason: dto.reason,
        }),
      );
    });
    const result = await this.findService(serviceId, actor);
    await this.notifyPendingTransfer(result);
    return result;
  }

  async cancelRequest(id: string, actor: Actor) {
    const request = await this.findRequestForMutation(id, actor);
    if (request.serviceId)
      throw new ConflictException(
        'Cancela el servicio desde el flujo operativo',
      );
    await this.dataSource.transaction(async (manager) => {
      request.status = 'cancelada';
      request.holdExpiresAt = null;
      await manager.save(GroupServiceRequest, request);
      await manager.update(
        GroupServiceRequestSelection,
        { requestId: id, status: 'reservada' },
        { status: 'liberada' },
      );
    });
    await this.audit(null, id, actor.id, 'solicitud_cancelada', null, null);
    return { cancelled: true };
  }

  async cancelService(serviceId: string, actor: Actor) {
    const current = await this.findService(serviceId, actor);
    if (current.estado === 'cancelado') return { cancelled: true };
    if (current.estado === 'finalizado') {
      throw new ConflictException(
        'No se puede cancelar un servicio grupal finalizado',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Servicios, serviceId, { estado: 'cancelado' });
      await manager.update(
        Viajes,
        {
          servicioId: serviceId,
          estado: Not(In(['finalizado', 'cancelado', 'rechazado'])),
        },
        { estado: 'cancelado' },
      );
      const participants = await manager.find(ServiceParticipant, {
        where: {
          serviceId,
          status: In(['reservada', 'pendiente_pago', 'activa']),
        },
      });
      if (participants.length) {
        await manager.update(
          ServiceParticipant,
          { id: In(participants.map((item) => item.id)) },
          { status: 'cancelada', holdExpiresAt: null, removedAt: new Date() },
        );
        for (const participant of participants) {
          const activeElsewhere = await manager.exists(ServiceParticipant, {
            where: {
              employeeId: participant.employeeId,
              serviceId: Not(serviceId),
              status: In(['reservada', 'pendiente_pago', 'activa']),
            },
          });
          if (!activeElsewhere) {
            await manager.update(Empleadas, participant.employeeId, {
              disponible: true,
            });
          }
        }
      }
      await manager.update(
        GroupServiceRequest,
        { serviceId },
        { status: 'cancelada', holdExpiresAt: null },
      );
    });
    await this.audit(
      serviceId,
      null,
      actor.id,
      'servicio_grupal_cancelado',
      { estado: current.estado },
      { estado: 'cancelado' },
    );
    this.realtime.emitToBoss(current.jefeId, {
      type: 'group_service_cancelled',
      data: { serviceId },
    });
    return { cancelled: true };
  }

  async findService(serviceId: string, actor: Actor) {
    const service = await this.services.findOne({
      where: { id: serviceId },
      relations: {
        cliente: true,
        jefe: true,
        empleada: true,
        participantes: { employee: { usuario: true, jefe: true } },
        viajes: { passengers: { employee: true }, chofer: true },
        pagos: { receiptValidation: true },
        receiptValidations: true,
        extrasServicios: { extraCatalogo: true, participant: true },
      },
    });
    if (!service || service.serviceType !== 'grupal')
      throw new NotFoundException('Servicio grupal no encontrado');
    if (actor.rol !== 'admin' && service.jefeId !== actor.id)
      throw new ForbiddenException('No puedes gestionar este servicio grupal');
    return service;
  }

  /**
   * El mismo acceso, resuelto por id de usuario en vez de por chat.
   *
   * El portal se identifica con la sesion, y de ella sale un id de usuario:
   * es la unica forma en que la responsable de un grupal puede cerrarlo.
   */
  async accesoDeParticipantePorUsuario(
    serviceId: string,
    usuarioId: string,
  ): Promise<{ participant: ServiceParticipant; responsible: boolean } | null> {
    const participant = await this.participants.findOne({
      where: {
        serviceId,
        status: In(['activa', 'reservada', 'pendiente_pago']),
        employee: { usuario: { id: usuarioId } },
      },
      relations: { employee: { usuario: true } },
    });
    return participant
      ? { participant, responsible: participant.role === 'responsable' }
      : null;
  }

  /** Cierra el grupal desde el portal. Mismo camino, otra identidad. */
  async finishByResponsibleUser(serviceId: string, usuarioId: string) {
    const access = await this.accesoDeParticipantePorUsuario(
      serviceId,
      usuarioId,
    );
    if (!access?.responsible)
      throw new ForbiddenException(
        'Solamente la responsable puede finalizar el servicio',
      );
    return this.cerrarComoResponsable(
      serviceId,
      access.participant.employee.usuarioId,
    );
  }

  /**
   * El cierre en si, ya con el permiso comprobado.
   *
   * Separado de las dos puertas de entrada para que el chat y el portal no
   * puedan divergir: el saldo pendiente, el estado y los avisos son los mismos
   * se entre por donde se entre.
   */
  private async cerrarComoResponsable(serviceId: string, actorUserId: string) {
    await this.dataSource.transaction(async (manager) => {
      const service = await manager.findOne(Servicios, {
        where: { id: serviceId, serviceType: 'grupal' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!service)
        throw new NotFoundException('Servicio grupal no encontrado');
      if (service.estado !== 'en_curso')
        throw new ConflictException('El servicio ya no está activo');
      if (
        service.metodoPago === 'transferencia' &&
        Number(service.pendingBalance) > 0.009
      )
        throw new ConflictException(
          'No se puede finalizar mientras exista saldo pendiente',
        );
      const now = new Date();
      service.estado = 'finalizado';
      service.horaFinServicio = now;
      service.duracionFinalHoras = service.horaInicioServicio
        ? Number(
            (
              (now.getTime() - service.horaInicioServicio.getTime()) /
              3_600_000
            ).toFixed(2),
          )
        : Number(service.duracionPactadaHoras);
      service.estadoLiquidacion = 'transporte_pendiente';
      service.recordatoriosRegreso = 0;
      service.proximoRecordatorioRegresoAt = new Date(Date.now() + 5 * 60_000);
      await manager.save(Servicios, service);

      const active = await manager.find(ServiceParticipant, {
        where: { serviceId, status: 'activa' },
      });
      const pending = await manager.find(ServiceParticipant, {
        where: {
          serviceId,
          status: In(['reservada', 'pendiente_pago']),
        },
      });
      for (const participant of active) {
        participant.status = 'retirada';
        participant.removedAt = now;
      }
      for (const participant of pending) {
        participant.status = 'cancelada';
        participant.removedAt = now;
      }
      await manager.save(ServiceParticipant, [...active, ...pending]);
      const employeeIds = active.map((item) => item.employeeId);
      for (const employeeId of employeeIds) {
        const otherActive = await manager.exists(ServiceParticipant, {
          where: {
            employeeId,
            serviceId: Not(serviceId),
            status: 'activa',
          },
        });
        if (!otherActive)
          await manager.update(Empleadas, employeeId, { disponible: true });
      }
      await manager.save(
        ServiceGroupAudit,
        manager.create(ServiceGroupAudit, {
          serviceId,
          requestId: null,
          actorUserId,
          action: 'servicio_finalizado',
          before: null,
          after: {
            durationFinalHours: service.duracionFinalHoras,
            totalFinal: service.totalFinal,
          },
          reason: null,
        }),
      );
    });
    await this.liquidationSync.syncOfficeRecord(serviceId);
    return this.services.findOne({
      where: { id: serviceId },
      relations: {
        cliente: true,
        participantes: { employee: true },
        viajes: true,
        extrasServicios: { extraCatalogo: true, participant: true },
      },
    });
  }

  private async findRequestForMutation(id: string, actor: Actor) {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException('Solicitud grupal no encontrada');
    this.assertOwner(request, actor);
    if (['cancelada', 'vencida'].includes(request.status))
      throw new ConflictException('La solicitud ya no está activa');
    return request;
  }

  private assertOwner(request: GroupServiceRequest, actor: Actor): void {
    if (actor.rol !== 'admin' && request.bossId !== actor.id)
      throw new ForbiddenException('No puedes gestionar esta solicitud');
  }

  private async assertEmployeeFree(
    manager: EntityManager,
    employeeId: string,
    requestId?: string | null,
    serviceId?: string,
  ) {
    const participantConflict = await manager
      .getRepository(ServiceParticipant)
      .createQueryBuilder('participant')
      .where('participant.employeeId = :employeeId', { employeeId })
      .andWhere('participant.status IN (:...statuses)', {
        statuses: ['reservada', 'pendiente_pago', 'activa'],
      })
      .andWhere(
        '(participant.holdExpiresAt IS NULL OR participant.holdExpiresAt > :now)',
        { now: new Date() },
      )
      .andWhere(
        serviceId ? 'participant.serviceId <> :serviceId' : '1 = 1',
        serviceId ? { serviceId } : {},
      )
      .getExists();
    if (participantConflict)
      throw new ConflictException('La empleada ya está reservada');

    const selectionQb = manager
      .getRepository(GroupServiceRequestSelection)
      .createQueryBuilder('selection')
      .where('selection.employeeId = :employeeId', { employeeId })
      .andWhere('selection.status = :status', { status: 'reservada' })
      .andWhere('selection.expiresAt > :now', { now: new Date() });
    if (requestId)
      selectionQb.andWhere('selection.requestId <> :requestId', { requestId });
    if (await selectionQb.getExists())
      throw new ConflictException('La empleada ya está reservada');

    const legacyConflict = await manager.findOne(Servicios, {
      where: {
        empleadaId: employeeId,
        serviceType: 'individual',
        estado: In(['pendiente', 'agendado', 'en_curso']),
      },
    });
    if (legacyConflict)
      throw new ConflictException('La empleada tiene otro servicio vigente');
  }

  private assertRequestComplete(request: GroupServiceRequest): void {
    if (
      !request.durationHours ||
      !request.paymentMethod ||
      request.locationLat === null ||
      request.locationLng === null
    )
      throw new BadRequestException(
        'Completa duración, pago y ubicación antes de cotizar',
      );
  }

  private validateTransportUnits(
    dto: ConfirmGroupQuoteDto,
    employeeIds: string[],
  ) {
    if (!dto.transportUnits.length)
      throw new BadRequestException('Configura al menos una unidad de ida');
    const keys = new Set<string>();
    for (const unit of dto.transportUnits) {
      const key = `${unit.direction}:${unit.unitNumber}`;
      if (keys.has(key))
        throw new BadRequestException('Hay unidades de transporte duplicadas');
      keys.add(key);
      for (const employeeId of unit.employeeIds) {
        if (!employeeIds.includes(employeeId))
          throw new BadRequestException(
            'Una pasajera no pertenece a la selección',
          );
      }
    }
    const outbound = new Set(
      dto.transportUnits
        .filter((unit) => unit.direction === 'ida')
        .flatMap((unit) => unit.employeeIds),
    );
    if (employeeIds.some((id) => !outbound.has(id)))
      throw new BadRequestException(
        'Todas las participantes deben tener transporte de ida',
      );
  }

  private validateTransportConfiguration(
    units: ConfigureGroupTransportDto['transportUnits'],
    employeeIds: string[],
  ) {
    const keys = new Set<string>();
    const passengersByDirection = new Map<string, Set<string>>();
    for (const unit of units) {
      const key = `${unit.direction}:${unit.unitNumber}`;
      if (keys.has(key))
        throw new BadRequestException('Hay unidades de transporte duplicadas');
      keys.add(key);
      const assigned =
        passengersByDirection.get(unit.direction) ?? new Set<string>();
      for (const employeeId of unit.employeeIds) {
        if (!employeeIds.includes(employeeId))
          throw new BadRequestException(
            'Una pasajera no pertenece a la plantilla activa',
          );
        if (assigned.has(employeeId))
          throw new BadRequestException(
            'Una empleada no puede viajar en dos unidades del mismo sentido',
          );
        assigned.add(employeeId);
      }
      passengersByDirection.set(unit.direction, assigned);
    }
    for (const [direction, assigned] of passengersByDirection) {
      if (employeeIds.some((id) => !assigned.has(id)))
        throw new BadRequestException(
          `Todas las participantes deben tener transporte de ${direction}`,
        );
    }
  }

  private billableVehicleCount(
    units: ConfirmGroupQuoteDto['transportUnits'],
  ): number {
    const outbound = new Set(
      units
        .filter((unit) => unit.direction === 'ida')
        .map((unit) => unit.unitNumber),
    ).size;
    const returns = new Set(
      units
        .filter((unit) => unit.direction === 'regreso')
        .map((unit) => unit.unitNumber),
    ).size;
    return Math.max(outbound, returns);
  }

  private async recalculateTransportCharge(
    manager: EntityManager,
    service: Servicios,
  ) {
    const rows: Array<{ tipo: string; count: string }> = await manager.query(
      `SELECT tipo, COUNT(*)::text AS count
       FROM viajes
       WHERE servicio_id = $1 AND estado NOT IN ('cancelado','rechazado')
       GROUP BY tipo`,
      [service.id],
    );
    const ordinaryUnits = Math.max(...rows.map((row) => Number(row.count)), 0);
    service.customerTransportCharge =
      Number(service.transportFeeSnapshot) * ordinaryUnits +
      Number(service.manualTransportAdjustment);
    service.totalTransporte = Number(service.customerTransportCharge);
    await manager.save(Servicios, service);
  }

  private async lockGroupService(
    manager: EntityManager,
    serviceId: string,
    actor: Actor,
  ) {
    const service = await manager.findOne(Servicios, {
      where: { id: serviceId, serviceType: 'grupal' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!service) throw new NotFoundException('Servicio grupal no encontrado');
    if (actor.rol !== 'admin' && service.jefeId !== actor.id)
      throw new ForbiddenException('No puedes gestionar este servicio');
    return service;
  }

  private receiptFingerprint(receipt: PaymentReceiptValidations | null) {
    if (!receipt) return null;
    const value = receipt.idSpei || receipt.folio || receipt.referencia;
    return value
      ? `${receipt.bancoOrigen ?? 'banco'}:${value}`.toLowerCase().trim()
      : null;
  }

  private async dispatchPendingTrips(service: Servicios) {
    await Promise.all(
      (service.viajes ?? [])
        .filter(
          (trip) =>
            trip.proveedorTransporte === 'interno' &&
            trip.estado === 'notificado',
        )
        .map((trip) => this.servicesService.dispatchViaje(trip.id)),
    );
  }

  private async applyPaidPendingChanges(
    manager: EntityManager,
    service: Servicios,
  ) {
    if (service.pendingDurationHours) {
      service.duracionPactadaHoras = Number(service.pendingDurationHours);
      service.pendingDurationHours = null;
      await manager.save(Servicios, service);
    }
    const pending = await manager.find(ServiceParticipant, {
      where: { serviceId: service.id, status: 'pendiente_pago' },
    });
    for (const participant of pending) {
      participant.status =
        service.estado === 'en_curso' ? 'activa' : 'reservada';
      participant.holdExpiresAt = null;
      if (service.estado === 'en_curso') {
        participant.joinedAt = new Date();
        await manager.update(Empleadas, participant.employeeId, {
          disponible: false,
        });
      }
    }
    if (pending.length) await manager.save(ServiceParticipant, pending);
    await manager.update(
      GroupServiceRequest,
      { serviceId: service.id },
      { status: 'confirmada', holdExpiresAt: null },
    );
  }

  /**
   * Push a cada participante al iniciar. Finalizar y agregar extras viven en
   * el portal. El texto no lleva
   * nombres ni importes porque sale en la pantalla de bloqueo. Nunca lanza:
   * el servicio ya empezo.
   */
  private async avisarInicioALaParticipante(
    serviceId: string,
    participant: ServiceParticipant,
  ): Promise<void> {
    const usuarioId = participant.employee?.usuarioId;
    if (!usuarioId) return;
    const responsable = participant.role === 'responsable';
    try {
      await this.notifications.notificar(usuarioId, {
        titulo: 'Servicio grupal iniciado',
        cuerpo: responsable
          ? 'Eres la responsable: consulta el transporte, registra extras y finaliza desde el portal.'
          : 'Puedes registrar los extras de tu catálogo desde el portal.',
        url: '/empleada/servicio',
        tag: `grupo-${serviceId}`,
        requireInteraction: true,
        relatedEntityId: serviceId,
        dedupeKey: `group_service_started:${serviceId}:${participant.employeeId}`,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo avisar del inicio del grupal ${serviceId} a ${participant.employeeId}: ${String(error)}`,
      );
    }
  }

  private notifyExternalBoss(organizerBossId: string, employee?: Empleadas) {
    if (employee?.jefeId && employee.jefeId !== organizerBossId) {
      this.realtime.emitToBoss(employee.jefeId, {
        type: 'external_employee_group_assignment',
        data: { employeeId: employee.id, organizerBossId },
      });
    }
  }

  private requestSnapshot(request: GroupServiceRequest) {
    return {
      durationHours: request.durationHours,
      paymentMethod: request.paymentMethod,
      locationLat: request.locationLat,
      locationLng: request.locationLng,
      locationReference: request.locationReference,
    };
  }

  /**
   * Saldo por transferir, por cada canal del cliente. En la web, ademas, el
   * aviso de pago completo cuando un pago registrado deja el saldo en cero.
   */
  private async notifyPendingTransfer(
    service: Servicios,
    opciones: { pagoRegistrado?: boolean } = {},
  ) {
    await this.grupoWeb.avisarSaldo(
      await this.origenWeb(service.id),
      service,
      opciones,
    );
  }

  /** La conversacion web de la que nacio el servicio, si nacio de una. */
  private async origenWeb(
    serviceId: string,
  ): Promise<{ conversationId: string | null }> {
    try {
      const request = await this.requests.findOne({
        where: { serviceId },
        select: { id: true, conversationId: true },
      });
      return { conversationId: request?.conversationId ?? null };
    } catch (error) {
      // Solo decide si hay aviso web; la operacion que lo origina ya se hizo.
      this.logger.warn(
        `No se pudo leer la solicitud del servicio grupal ${serviceId}: ${String(error)}`,
      );
      return { conversationId: null };
    }
  }

  private async audit(
    serviceId: string | null,
    requestId: string | null,
    actorUserId: string | null,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reason?: string,
  ) {
    await this.auditRepository.save(
      this.auditRepository.create({
        serviceId,
        requestId,
        actorUserId,
        action,
        before,
        after,
        reason: reason ?? null,
      }),
    );
  }

  private async releaseExpiredHolds() {
    const expired = await this.requests.find({
      where: {
        holdExpiresAt: MoreThan(new Date(0)),
        status: In(['seleccionando', 'reservada', 'esperando_pago']),
      },
    });
    const now = new Date();
    for (const candidata of expired.filter(
      (item) => item.holdExpiresAt && item.holdExpiresAt <= now,
    )) {
      // Las cuatro escrituras van juntas: si fallaba la del servicio la
      // solicitud seguia vigente con sus participantes ya cancelados, y la
      // siguiente pasada no los volvia a tocar. La fila se relee con bloqueo
      // porque otra replica, o el propio jefe, pudo resolverla entre medias.
      const request = await this.dataSource.transaction(async (manager) => {
        const actual = await manager.findOne(GroupServiceRequest, {
          where: { id: candidata.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !actual ||
          !['seleccionando', 'reservada', 'esperando_pago'].includes(
            actual.status,
          ) ||
          !actual.holdExpiresAt ||
          actual.holdExpiresAt > new Date()
        ) {
          return null;
        }
        if (actual.serviceId) {
          const service = await manager.findOneBy(Servicios, {
            id: actual.serviceId,
          });
          if (
            service?.estado === 'pendiente' &&
            Number(service.totalPaid) === 0
          ) {
            await manager.update(
              ServiceParticipant,
              {
                serviceId: service.id,
                status: In(['reservada', 'pendiente_pago']),
              },
              { status: 'cancelada', holdExpiresAt: null },
            );
            service.estado = 'cancelado';
            await manager.save(Servicios, service);
          }
        }
        await manager.update(
          GroupServiceRequestSelection,
          { requestId: actual.id, status: 'reservada' },
          { status: 'liberada' },
        );
        actual.status = 'vencida';
        actual.holdExpiresAt = null;
        return manager.save(GroupServiceRequest, actual);
      });
      if (!request) continue;
      this.realtime.emitToBoss(request.bossId, {
        type: 'group_service_hold_expired',
        data: { requestId: request.id, serviceId: request.serviceId },
      });

      /*
       * Nivel 1: la reserva se libera sola y las modelos que estaban apartadas
       * vuelven al catalogo. Si el jefe no se entera, el cliente sigue creyendo
       * que su grupo esta guardado.
       *
       * En su propio try/catch: la reserva ya se libero y un aviso que falla no
       * puede deshacer eso.
       */
      try {
        await this.notifications.notificar(request.bossId, {
          titulo: 'Se venció una reserva de grupo',
          cuerpo: 'Las modelos apartadas volvieron al catálogo.',
          url: '/jefe?tab=grupos',
          tag: `grupo-vencido-${request.id}`,
          requireInteraction: true,
        });
      } catch (err) {
        this.logger.error(
          'Error enviando el aviso push de la reserva vencida:',
          err,
        );
      }
    }
  }
}
