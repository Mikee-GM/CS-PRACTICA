import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuarios } from './entities/user.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeEventsService } from '../realtime/realtime.service';

export type WorkShiftStatus = {
  enJornada: boolean;
  jornadaActualizadaAt: Date | null;
  /** Por que cerro, si lo dijo. Siempre opcional. */
  jornadaMotivo: string | null;
};

/**
 * Estado de jornada: si la persona sigue trabajando hoy.
 *
 * Distinto de `disponible`, que dice si puede tomar algo *ahora*. Una modelo en
 * servicio y una que ya cerro su dia estaban las dos "no disponibles", y sin
 * separarlas no habia forma de saber si el hueco era de una hora o del resto
 * del dia.
 *
 * Cerrar la jornada avisa, no bloquea: el reparto de servicios y viajes sigue
 * funcionando igual. Lo que cambia es que ahora alguien se entera.
 */
@Injectable()
export class WorkShiftStatusService {
  private readonly logger = new Logger(WorkShiftStatusService.name);

  constructor(
    @InjectRepository(Usuarios)
    private readonly usuarios: Repository<Usuarios>,
    @InjectRepository(Empleadas)
    private readonly empleadas: Repository<Empleadas>,
    private readonly realtime: RealtimeEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  async getStatus(userId: string): Promise<WorkShiftStatus> {
    const user = await this.usuarios.findOneOrFail({ where: { id: userId } });
    return {
      enJornada: user.enJornada,
      jornadaActualizadaAt: user.jornadaActualizadaAt,
      jornadaMotivo: user.jornadaMotivo,
    };
  }

  /**
   * Cambia el estado y avisa a quien corresponda segun el rol.
   *
   * El aviso va despues de guardar y aislado: que el aviso falle no puede dejar
   * a la persona sin poder cerrar su jornada.
   */
  async setStatus(
    user: Usuarios,
    enJornada: boolean,
    motivo?: string,
  ): Promise<WorkShiftStatus> {
    if (user.enJornada === enJornada) {
      return {
        enJornada: user.enJornada,
        jornadaActualizadaAt: user.jornadaActualizadaAt,
        jornadaMotivo: user.jornadaMotivo,
      };
    }

    const jornadaActualizadaAt = new Date();
    /*
     * El motivo solo acompaña al cierre, y al volver se borra: describia por
     * que no estaba, y ya esta. Dejarlo puesto haria que el panel siguiera
     * contando el motivo de ayer de alguien que hoy lleva horas trabajando.
     */
    const jornadaMotivo = enJornada ? null : motivo?.trim() || null;
    await this.usuarios.update(user.id, {
      enJornada,
      jornadaActualizadaAt,
      jornadaMotivo,
      jornadaMotivoAt: jornadaMotivo ? jornadaActualizadaAt : null,
    });

    try {
      /*
       * El admin se entera pase lo que pase. La modelo ademas avisa a su jefe
       * con un push, porque es ante quien responde: el tablero de admin puede
       * no estar abierto cuando ella cierra su dia.
       */
      this.marcarParaAdmin(
        user,
        enJornada,
        jornadaActualizadaAt,
        jornadaMotivo,
      );

      if (user.rol === 'empleada') {
        await this.avisarAlJefeDeLaModelo(
          user,
          enJornada,
          jornadaMotivo,
          jornadaActualizadaAt,
        );
      }
    } catch (error) {
      this.logger.error('No se pudo avisar del cambio de jornada:', error);
    }

    return { enJornada, jornadaActualizadaAt, jornadaMotivo };
  }

  /**
   * La modelo responde ante su jefe, asi que el aviso va a el como push y no
   * a un tablero que quiza nadie este mirando.
   */
  private async avisarAlJefeDeLaModelo(
    user: Usuarios,
    enJornada: boolean,
    motivo: string | null,
    cambioAt: Date,
  ): Promise<void> {
    const empleada = await this.empleadas.findOne({
      where: { usuarioId: user.id },
      relations: { jefe: true, jefeSecundario: true },
    });
    if (!empleada) return;

    const nombre = empleada.nombreArtistico || 'Una modelo';
    // Se avisa al jefe principal y al secundario: cualquiera de los dos puede
    // estar cubriendo el turno cuando llega el cambio.
    const destinos = [empleada.jefe, empleada.jefeSecundario]
      .filter((jefe): jefe is Usuarios => Boolean(jefe))
      .filter(
        (jefe, indice, lista) =>
          lista.findIndex((otro) => otro.id === jefe.id) === indice,
      );

    /*
     * Sin el nombre de la modelo ni el motivo: una notificacion se lee en la
     * pantalla bloqueada. El detalle esta en el panel, al tocarla.
     */
    for (const jefe of destinos) {
      try {
        await this.notifications.notificar(jefe.id, {
          titulo: enJornada
            ? 'Una modelo volvió a su jornada'
            : 'Una modelo cerró su jornada',
          cuerpo: 'Toca para ver tu equipo.',
          url: '/jefe/equipo',
          tag: `jornada-${empleada.id}`,
          dedupeKey: `jornada:${empleada.id}:${jefe.id}:${cambioAt.getTime()}`,
        });
      } catch (error) {
        this.logger.error(
          `No se pudo avisar al jefe ${jefe.id} del cambio de jornada:`,
          error,
        );
      }
    }

    for (const jefe of destinos) {
      this.realtime.emitToBoss(jefe.id, {
        type: 'employee_work_shift_changed',
        data: {
          userId: user.id,
          employeeId: empleada.id,
          employeeName: nombre,
          enJornada,
          motivo,
        },
      });
    }
  }

  /**
   * Marca el cambio en el panel de admin. Vale para los tres roles: el admin
   * quiere ver quien esta trabajando hoy sin importar de quien dependa.
   */
  private marcarParaAdmin(
    user: Usuarios,
    enJornada: boolean,
    jornadaActualizadaAt: Date,
    motivo: string | null = null,
  ): void {
    this.realtime.emitToJefes({
      type: 'staff_work_shift_changed',
      data: {
        userId: user.id,
        rol: user.rol,
        nombre: [user.nombre, user.apellido].filter(Boolean).join(' ').trim(),
        enJornada,
        jornadaActualizadaAt,
        motivo,
      },
    });
  }

  /** Personal fuera de jornada, para el panel de admin. */
  async listOffDuty(): Promise<
    Array<{
      id: string;
      rol: Usuarios['rol'];
      nombre: string;
      email: string;
      jornadaActualizadaAt: Date | null;
      jornadaMotivo: string | null;
    }>
  > {
    const users = await this.usuarios.find({
      where: { enJornada: false, activo: true },
      order: { jornadaActualizadaAt: 'DESC' },
      select: {
        id: true,
        rol: true,
        nombre: true,
        apellido: true,
        email: true,
        jornadaActualizadaAt: true,
        jornadaMotivo: true,
      },
      take: 100,
    });

    return users.map((user) => ({
      id: user.id,
      rol: user.rol,
      nombre:
        [user.nombre, user.apellido].filter(Boolean).join(' ').trim() ||
        user.email,
      email: user.email,
      jornadaActualizadaAt: user.jornadaActualizadaAt,
      jornadaMotivo: user.jornadaMotivo,
    }));
  }
}
