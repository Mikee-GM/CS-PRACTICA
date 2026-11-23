import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Viajes } from '../trips/entities/trip.entity';
import { Choferes } from './entities/driver.entity';
import { Servicios } from '../services/entities/service.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { SettlementsService } from '../transport-operations/settlements.service';
import { AiMessageService } from '../ai/ai-message.service';
import { ServicesService } from '../services/services.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationNotifier } from '../conversations/conversation-notifier';
import { avisarAlChatWeb, unaVez } from '../services/aviso-al-cliente-web';

/** Lo que la modelo tiene de margen antes de que se le cuente la espera. */
const ESPERA_MS = 600_000;

/**
 * El avance de un viaje, contado desde el lado del chofer.
 *
 * Existe para que las transiciones del viaje tengan un unico lugar que llamar
 * desde HTTP, sin depender de ningun canal de mensajeria.
 *
 * Aqui vive solo el negocio --validar, cambiar el estado y avisar a quien
 * corresponda--; lo que es propio del chat, como reescribir el mensaje del
 * chofer con el boton siguiente, se queda en el manejador. Los dos caminos
 * llaman a esto, de modo que marcar la llegada desde el portal y marcarla
 * desde el chat hacen exactamente lo mismo.
 */
@Injectable()
export class DriverTripsService {
  private readonly logger = new Logger(DriverTripsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Viajes)
    private readonly viajes: Repository<Viajes>,
    @InjectRepository(Choferes)
    private readonly choferes: Repository<Choferes>,
    @InjectRepository(Servicios)
    private readonly servicios: Repository<Servicios>,
    private readonly realtime: RealtimeEventsService,
    private readonly settlements: SettlementsService,
    private readonly notifications: NotificationsService,
    private readonly aiMessages: AiMessageService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    /*
     * Los avisos al cliente que reservo por la web. Opcional y al final por la
     * misma razon que en `ServicesService`: sin el, el aviso web simplemente no
     * sale.
     */
    @Optional()
    private readonly conversationNotifier?: ConversationNotifier,
  ) {}

  /**
   * Manda un aviso push sin que su fallo arrastre a nada.
   *
   * El viaje ya avanzo cuando esto se llama: un aviso que no sale se registra y
   * se sigue.
   */
  private async avisar(
    usuarioId: string | null | undefined,
    aviso: {
      titulo: string;
      cuerpo: string;
      url: string;
      tag?: string;
      requireInteraction?: boolean;
      relatedEntityId?: string;
      dedupeKey?: string;
    },
  ): Promise<void> {
    if (!usuarioId) return;
    try {
      await this.notifications.notificar(usuarioId, aviso);
    } catch (err) {
      this.logger.error(`Error enviando el aviso push "${aviso.titulo}":`, err);
    }
  }

  /**
   * Reconcilia la disponibilidad operativa despues de cerrar un viaje.
   *
   * `disponible` no debe quedar pegado en falso despues del ultimo viaje,
   * pero tampoco se puede poner en true si el chofer conserva otro viaje
   * abierto. Se consulta el estado persistido, no la entidad que traia el
   * llamador, porque el cierre puede llegar casi al mismo tiempo que otra
   * asignacion.
   */
  private async reconciliarDisponibilidad(choferId: string): Promise<void> {
    const viajesAbiertos = await this.viajes.find({
      where: {
        choferId,
        estado: Not(In(['finalizado', 'cancelado', 'rechazado'])),
      },
      select: { id: true },
    });

    if (viajesAbiertos.length > 0) return;

    await this.choferes.update(choferId, { disponible: true });
    this.realtime.emitToDriver(choferId, {
      type: 'driver_availability_updated',
      data: { disponible: true },
    });
  }

  /**
   * El avance del viaje, a las pantallas de quienes lo estan esperando.
   *
   * Los tres pasos del chofer --ya llegue, ya la recogi, ya la deje-- salian
   * solo por el chat del grupo del jefe. Ni su panel ni el portal de la modelo
   * se enteraban de nada, y el propio chofer veia su pantalla igual hasta
   * recargar a mano. Es justo el tramo en el que alguien esta esperando abajo,
   * asi que es donde mas se nota que la pantalla no diga nada.
   *
   * Va al canal de los tres: el jefe coordina, la modelo espera el coche y el
   * chofer tiene delante los botones del viaje.
   */
  private avisarAvanceDelViaje(
    trip: Viajes,
    chofer: Choferes | null,
    accion: 'driver_arrived' | 'employee_picked_up' | 'trip_finished',
  ): void {
    const evento = {
      type: 'trip_status_updated',
      data: {
        tripId: trip.id,
        serviceId: trip.servicioId,
        tripType: trip.tipo,
        action: accion,
        employeeName: trip.servicio?.empleada?.nombreArtistico ?? null,
        driverName: chofer?.nombre ?? null,
      },
    };

    if (trip.choferId) this.realtime.emitToDriver(trip.choferId, evento);
    if (trip.servicio) {
      this.realtime.emitToEmployee(trip.servicio.empleadaId, evento);
      this.realtime.emitToBoss(trip.servicio.jefeId, evento);
    }
  }

  /**
   * El chofer toma una oferta de viaje.
   *
   * La oferta se manda a varios a la vez, asi que esto es una carrera: gana
   * quien escriba primero. La condicion va dentro del propio UPDATE --id, su
   * chofer y estado `notificado`-- de modo que la base decide, no el codigo.
   * Comprobar antes y escribir despues dejaria una ventana en la que dos
   * choferes se llevan el mismo viaje.
   *
   * Si no gana, no es un error: alguien fue mas rapido, y quien llama debe
   * decirlo con esas palabras.
   */
  async aceptarOferta(
    viajeId: string,
    choferId: string,
  ): Promise<{ aceptado: boolean; viaje: Viajes | null }> {
    const gano = await this.dataSource.transaction(async (manager) => {
      const resultado = await manager
        .createQueryBuilder()
        .update(Viajes)
        .set({
          estado: 'aceptado',
          horaAceptacion: new Date(),
          // La oferta deja de estar viva: sin limpiarlo, el barrido de ofertas
          // vencidas la tomaria como pendiente.
          ofertaExpiraEn: null,
        })
        .where('id = :viajeId AND chofer_id = :choferId AND estado = :estado', {
          viajeId,
          choferId,
          estado: 'notificado',
        })
        .execute();

      if (resultado.affected !== 1) return false;

      await manager.update(Choferes, choferId, {
        disponible: false,
        // Aceptar borra la racha: el contador mide rechazos SEGUIDOS, y sin
        // este reinicio tres rechazos sueltos repartidos en semanas acabarian
        // multando igual que tres seguidos.
        rechazosConsecutivos: 0,
      });
      return true;
    });

    if (!gano) return { aceptado: false, viaje: null };

    // Ya es suyo: se detiene el reparto para que no se lo ofrezcan a nadie mas.
    this.servicesService.clearDispatchTimeout(viajeId);

    const viaje = await this.cargarViajeDelChofer(viajeId, choferId);
    const chofer = await this.choferes.findOne({ where: { id: choferId } });
    await this.servicesService.markTransportAssigned(
      viaje.servicioId,
      chofer?.usuarioId,
      'chofer',
    );

    // El jefe se entera por el push que el puente deriva de `trip_accepted`.
    await this.avisarALaModeloQueVaEnCamino(viaje);

    this.realtime.emitToDriver(choferId, {
      type: 'trip_accepted',
      data: { tripId: viajeId },
    });
    if (viaje.servicio) {
      this.realtime.emitToEmployee(viaje.servicio.empleadaId, {
        type: 'trip_accepted',
        data: { tripId: viajeId, serviceId: viaje.servicio.id },
      });
      this.realtime.emitToBoss(viaje.servicio.jefeId, {
        type: 'trip_accepted',
        data: { tripId: viajeId, serviceId: viaje.servicio.id },
      });
    }

    return { aceptado: true, viaje };
  }

  /**
   * Le dice a la modelo que su chofer ya va en camino.
   *
   * Solo por push: los datos del chofer y del coche los ve en su portal, detras
   * del toque.
   */
  private async avisarALaModeloQueVaEnCamino(trip: Viajes): Promise<void> {
    const servicio = trip.servicio;
    if (!servicio) return;

    // El evento posterior del puente reutiliza esta clave.
    await this.avisar(servicio.empleada?.usuarioId, {
      titulo: 'Tu chofer va en camino',
      cuerpo: 'Toca para ver los datos del coche.',
      url: '/empleada/portal',
      tag: `viaje-${trip.id}`,
      requireInteraction: true,
      relatedEntityId: servicio.id,
      dedupeKey: `employee:trip_accepted:${servicio.id}:event`,
    });
  }

  /**
   * El chofer deja pasar una oferta.
   *
   * El rechazo en si --la racha, la reoferta al siguiente-- ya vivia en
   * `ServicesService`; aqui solo se le devuelve la disponibilidad, que es lo
   * que hacia el manejador del chat despues de llamarlo.
   */
  async rechazarOferta(viajeId: string, choferId: string): Promise<boolean> {
    const rechazado = await this.servicesService.rechazarOfertaManual(
      viajeId,
      choferId,
    );
    /*
     * Solo se le devuelve la disponibilidad si de verdad era su oferta. Un
     * toque repetido sobre una tarjeta que ya no vale no puede marcarlo como
     * libre en medio de otro viaje.
     */
    if (rechazado) {
      await this.choferes.update(choferId, { disponible: true });
    }
    return rechazado;
  }

  /**
   * El chofer llego al punto de recogida.
   *
   * Avisa a la modelo --los datos del coche, que son su unica forma de saber
   * que se sube al correcto, los ve en su portal-- y le arranca el margen de
   * espera. El jefe lo ve en su panel por `trip_status_updated`.
   */
  async marcarLlegada(viajeId: string, choferId: string): Promise<Viajes> {
    const trip = await this.cargarViajeDelChofer(viajeId, choferId);

    if (trip.estado !== 'aceptado') {
      throw new ConflictException(`El viaje está en estado: ${trip.estado}`);
    }

    await this.viajes.update(trip.id, { estado: 'llegado' });
    trip.estado = 'llegado';

    const chofer = await this.choferes.findOne({ where: { id: choferId } });

    await this.avisarLlegadaALaEmpleada(trip);
    this.avisarAvanceDelViaje(trip, chofer, 'driver_arrived');

    return trip;
  }

  /**
   * La modelo ya subio al coche y arranca el trayecto al cliente.
   *
   * Cancela el margen de espera: ya no procede cobrarlo.
   *
   * Admite venir de `llegado` y tambien de `aceptado`, igual que antes: hay
   * choferes que recogen sin llegar a marcar la llegada, y bloquearlo dejaria
   * el viaje atascado.
   */
  async marcarRecogida(viajeId: string, choferId: string): Promise<Viajes> {
    const trip = await this.cargarViajeDelChofer(viajeId, choferId);

    if (trip.estado !== 'llegado' && trip.estado !== 'aceptado') {
      throw new ConflictException(`El viaje está en estado: ${trip.estado}`);
    }

    const ahora = new Date();
    await this.viajes.update(trip.id, {
      estado: 'en_curso',
      horaInicioViaje: ahora,
    });
    trip.estado = 'en_curso';
    trip.horaInicioViaje = ahora;

    // La espera deja de contar en cuanto sube al coche.
    this.servicesService.clearWaitTimeout(trip.servicioId);

    const chofer = await this.choferes.findOne({ where: { id: choferId } });
    await this.servicesService.markEmployeeTripProgress(
      trip.servicioId,
      trip.tipo,
      'en_route',
      { userId: chofer?.usuarioId, type: 'chofer' },
    );

    this.avisarAvanceDelViaje(trip, chofer, 'employee_picked_up');

    return trip;
  }

  /**
   * El viaje termino.
   *
   * Es la transicion con mas cola de las tres, y la unica que toca dinero: al
   * cerrar un viaje de regreso decide el estado de liquidacion del servicio y
   * dispara el recibo final al cliente. Por eso conserva el orden exacto de
   * los efectos que tenia en el chat, incluida la escritura en paralelo.
   *
   * Lo que cambia segun el tramo:
   *  - ida: el servicio arranca de verdad, y si estaba agendado pasa a en_curso.
   *  - regreso: se anota la llegada a casa y se cierra la liquidacion --salvo
   *    que quede cobro final pendiente--.
   */
  async finalizarViaje(viajeId: string, choferId: string): Promise<Viajes> {
    const trip = await this.cargarViajeDelChofer(viajeId, choferId);

    if (trip.estado !== 'en_curso') {
      throw new ConflictException(`El viaje está en estado: ${trip.estado}`);
    }

    const horaFin = new Date();
    trip.estado = 'finalizado';
    trip.horaFinViaje = horaFin;

    const chofer = await this.choferes.findOne({ where: { id: choferId } });

    await this.viajes.update(trip.id, {
      estado: 'finalizado',
      horaFinViaje: horaFin,
    });
    // El chofer vuelve a estar libre al terminar su ultimo viaje abierto.
    await this.reconciliarDisponibilidad(choferId);

    const escrituras: Promise<unknown>[] = [];

    if (trip.servicio) {
      const cambios: Partial<Servicios> = {};

      if (trip.tipo === 'ida') {
        await this.avisar(trip.servicio.empleada?.usuarioId, {
          titulo: 'Llegaste al destino',
          cuerpo: 'Inicia el servicio desde tu portal cuando estés lista.',
          url: '/empleada/servicio',
          tag: `viaje-${trip.id}`,
          requireInteraction: true,
          relatedEntityId: trip.servicio.id,
          dedupeKey: `employee:trip_finished:${trip.id}`,
        });
      } else {
        const horaLlegada = new Date();
        trip.servicio.horaLlegadaCasa = horaLlegada;
        cambios.horaLlegadaCasa = horaLlegada;
        /*
         * Si todavia falta el cobro final por transferencia (duracion
         * abierta), no se puede dar por cerrada la liquidacion: el mismo
         * criterio que ya usa el camino de Uber en updateUberStatus.
         */
        cambios.estadoLiquidacion = trip.servicio.cobroFinalPendiente
          ? 'transporte_pendiente'
          : 'cerrada';
      }

      // En la ida no hay nada que escribir en el servicio: TypeORM rechaza un
      // UPDATE sin valores (`UpdateValuesMissingError`) y el viaje quedaba
      // finalizado con la peticion en 500 y el servicio sin avanzar.
      if (Object.keys(cambios).length > 0) {
        escrituras.push(
          this.servicios.update(
            trip.servicio.id,
            cambios as QueryDeepPartialEntity<Servicios>,
          ),
        );
      }
    }

    await Promise.all(escrituras);

    await this.settlements
      .syncDriverSettlement(trip.id)
      .catch((error) =>
        this.logger.error(
          `El viaje ${trip.id} finalizó, pero no se pudo sincronizar su liquidación`,
          error,
        ),
      );

    if (trip.servicio) {
      await this.servicesService.markEmployeeTripProgress(
        trip.servicio.id,
        trip.tipo,
        'arrived',
        { userId: chofer?.usuarioId, type: 'chofer' },
      );
    }

    if (trip.tipo === 'regreso' && trip.servicio) {
      await this.cerrarServicioDeRegreso(trip);
    }

    // Estos van al final y fuera de las ramas, igual que estaban en el chat:
    // la calificacion se pide siempre, y al cliente se le avisa solo cuando el
    // viaje que termina es el de ida, que es cuando llega ella.
    await this.pedirCalificacionAlaEmpleada(trip);
    await this.pedirCalificacionAlChofer(trip);
    if (trip.tipo === 'ida') await this.avisarLlegadaAlCliente(trip);
    this.avisarAvanceDelViaje(trip, chofer, 'trip_finished');

    return trip;
  }

  /**
   * Le pide al chofer que califique a la empleada del viaje.
   *
   * Sale del cierre, que es el punto por el que pasan el portal y el chat, asi
   * que ninguna via pierde la valoracion. Califica en su portal
   * (`ratings/pending-employees`) Sin `tipo`: es el unico momento en que se acuerda del viaje.
   */
  private async pedirCalificacionAlChofer(trip: Viajes): Promise<void> {
    if (!trip.choferId) return;
    const chofer = await this.choferes.findOne({
      where: { id: trip.choferId },
      select: { id: true, usuarioId: true },
    });
    await this.avisar(chofer?.usuarioId, {
      titulo: 'Califica el viaje',
      cuerpo: 'Terminaste un viaje. Toca para calificar a tu pasajera.',
      url: '/chofer/portal',
      tag: `calificar-viaje-${trip.id}`,
      relatedEntityId: trip.id,
      dedupeKey: `driver:rate_employee:${trip.id}`,
    });
  }

  /**
   * Le pide a la modelo que califique el trayecto recien terminado. Califica en
   * su portal (`ratings/pending-drivers`).
   */
  private async pedirCalificacionAlaEmpleada(trip: Viajes): Promise<void> {
    await this.avisar(trip.servicio?.empleada?.usuarioId, {
      titulo: 'Califica a tu chofer',
      cuerpo: 'Terminó tu trayecto. Toca para dejar tu valoración.',
      url: '/empleada/portal',
      tag: `calificar-chofer-${trip.id}`,
      relatedEntityId: trip.id,
      dedupeKey: `employee:rate_driver:${trip.id}`,
    });
  }

  /**
   * Le avisa al cliente de que la modelo ya llego.
   *
   * Solo al terminar la ida. El texto lo redacta la IA en personaje; si falla,
   * sale el de reserva, porque el cliente tiene que enterarse igual.
   */
  private async avisarLlegadaAlCliente(trip: Viajes): Promise<void> {
    const servicio = trip.servicio;
    if (!servicio) return;

    const respaldo = 'Ya llegué al punto que cuadramos, aquí te espero';
    // Una sola redaccion para los dos canales: el cliente que tiene ambos lee
    // lo mismo y la IA se paga una vez.
    const redactar = unaVez(() =>
      this.aiMessages.generate(
        'employee_arrived',
        { employeeName: servicio.empleada?.nombreArtistico },
        respaldo,
      ),
    );

    await avisarAlChatWeb(
      this.conversationNotifier,
      this.logger,
      servicio,
      redactar,
      { respaldo },
    );
  }

  /**
   * El cierre de cara al cliente cuando termina el viaje de regreso.
   *
   * Manda la cuenta definitiva y la invitacion a calificar. Con chofer propio
   * esto no lo hacia nadie: solo ocurria por las rutas de Uber, asi que un
   * servicio con transporte interno se quedaba sin recibo.
   */
  private async cerrarServicioDeRegreso(trip: Viajes): Promise<void> {
    const servicio = trip.servicio;
    if (!servicio) return;

    const textoCompletado =
      'El servicio quedó completado: la empleada llegó a su destino.';
    // En la web sale el mismo aviso nombrandola a ella en vez de "la
    // empleada" (lo adapta `avisarAlChatWeb`).
    await avisarAlChatWeb(
      this.conversationNotifier,
      this.logger,
      servicio,
      textoCompletado,
    );

    await this.servicesService
      .sendFinalReceiptAndAward(servicio.id)
      .catch((error) =>
        this.logger.error(
          `No se pudo enviar el recibo final del servicio ${servicio.id}:`,
          error,
        ),
      );

    this.realtime.emitToBoss(servicio.jefeId, {
      type: 'trip_status_updated',
      data: {
        serviceId: trip.servicioId,
        tripId: trip.id,
        state: 'finalizado',
        tripType: 'regreso',
      },
    });
    if (servicio.clienteId) {
      this.realtime.emitToClient(servicio.clienteId, {
        type: 'service_fully_completed',
        data: { serviceId: trip.servicioId, tripId: trip.id },
      });
    }
  }

  /**
   * El chofer que hay detras del usuario de la sesion del portal.
   *
   * El guard del portal deja el id de usuario, no el de chofer, y las
   * transiciones razonan sobre el chofer porque es lo que tiene el viaje.
   */
  async choferDeUsuario(usuarioId: string): Promise<string> {
    const chofer = await this.choferes.findOne({
      where: { usuarioId },
      select: { id: true },
    });
    if (!chofer) {
      throw new NotFoundException('No se encontró tu perfil de chofer');
    }
    return chofer.id;
  }

  /**
   * Carga el viaje comprobando que sea de quien dice serlo.
   *
   * La comprobacion vive aqui y no en cada llamador para que el portal y el
   * chat no puedan divergir: quien entra por HTTP trae su id de chofer del
   * guard, y quien entra por el chat lo trae de su chat vinculado, pero la
   * regla que decide es la misma.
   */
  private async cargarViajeDelChofer(
    viajeId: string,
    choferId: string,
  ): Promise<Viajes> {
    const trip = await this.viajes.findOne({
      where: { id: viajeId },
      relations: {
        servicio: {
          cliente: true,
          jefe: true,
          empleada: { usuario: true, jefe: true },
        },
      },
    });

    if (!trip) throw new NotFoundException('Viaje no encontrado');
    if (trip.choferId !== choferId) {
      throw new ForbiddenException('Este viaje está asignado a otro chofer');
    }
    return trip;
  }

  /**
   * Avisa a la modelo de que el chofer ya llego y arranca su margen de espera.
   *
   * Los datos del coche y el boton de prorroga estan en su portal.
   */
  private async avisarLlegadaALaEmpleada(trip: Viajes): Promise<void> {
    const servicio = trip.servicio;
    if (!servicio) return;

    await this.avisar(servicio.empleada?.usuarioId, {
      titulo: 'Tu chofer ya llegó',
      cuerpo: 'Está en el punto de recogida. Toca para ver sus datos.',
      url: '/empleada/portal',
      tag: `viaje-${trip.id}`,
      requireInteraction: true,
      relatedEntityId: servicio.id,
      dedupeKey: `employee:trip_status_updated:${servicio.id}:driver_arrived`,
    });
    this.servicesService.startWaitTimeout(servicio.id, ESPERA_MS);
  }
}
