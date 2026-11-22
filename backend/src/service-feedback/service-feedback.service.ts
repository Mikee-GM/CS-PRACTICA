import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { describeError } from '../common/errors/error-message';
import {
  CONVERSATION_STATUS_CHANGED,
  ConversationStatusChangedEvent,
} from '../conversations/conversation-events';
import {
  ConversationsService,
  ResumenDeConversacion,
} from '../conversations/conversations.service';
import { DisciplineService } from '../discipline/discipline.service';
import { EmployeeReportsService } from '../employee-reports/employee-reports.service';
import type { ReportCategory } from '../employee-reports/entities/employee-report.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import type {
  CalificarServicioDto,
  MotivoDeCalificacion,
  ReportarServicioDto,
  ReportarViajeDto,
} from './dto/service-feedback.dto';

/**
 * Plazo para calificar y reportar un servicio desde que termina.
 *
 * Es el mismo que hacen cumplir `DisciplineService` (calificaciones) y
 * `EmployeeReportsService` (reportes). Se repite aqui solo para no ofrecer en
 * la lista algo que despues se rechazaria; quien manda es la validacion de
 * esos dos servicios.
 */
export const VENTANA_DE_VALORACION_MS = 24 * 60 * 60 * 1000;

/** Tope de servicios en la lista; en 24 horas un cliente no pasa de pocos. */
export const MAX_SERVICIOS_POR_VALORAR = 20;

const ETIQUETAS_DE_MOTIVO: Record<MotivoDeCalificacion, string> = {
  trato: 'Trato',
  puntualidad: 'Puntualidad',
  comunicacion: 'Comunicación',
  otro: 'Otro',
};

/**
 * Lo que el cliente ve de un servicio terminado que aun puede valorar. De la
 * modelo solo va lo que ya publica el catalogo; nunca el comentario de otra
 * persona ni ids de calificaciones o reportes.
 */
export type ServicioPorValorar = {
  servicioId: string;
  finalizadoEn: Date;
  grupal: boolean;
  modelos: Array<{
    id: string;
    nombreArtistico: string;
    /** `null` mientras no la haya calificado. */
    estrellas: number | null;
  }>;
  /** Categorias que ya reporto: el indice unico rechazaria repetirlas. */
  categoriasReportadas: ReportCategory[];
};

export type CalificacionDelCliente = {
  servicioId: string;
  // La columna admite nulos, pero una calificacion del cliente siempre la
  // lleva: `resolveInteractionForPerson` exige sujeto.
  empleadaId: string | null;
  estrellas: number;
};

export type ReporteRecibido = {
  id: string;
  categoria: ReportCategory;
  creadoEn: Date;
};

type FilaPorValorar = {
  servicio_id: string;
  finalizado_en: Date;
  service_type: string;
  empleada_id: string;
  nombre_artistico: string;
  estrellas: number | null;
  categorias_reportadas: ReportCategory[] | null;
};

/**
 * Lo que pasa despues de un servicio: calificar, reportar y
 * volver a contratar desde el chat web, y los reportes del chofer desde su
 * portal.
 *
 * No hay reglas nuevas: cada accion entra por el metodo de siempre
 * (`createClientRatingIdempotent`, `EmployeeReportsService`), de modo que la
 * ventana, la propiedad del servicio y los efectos disciplinarios no pueden
 * divergir entre las dos vias. Aqui solo se resuelve quien es el cliente a
 * partir de la sesion y se recorta lo que se le devuelve.
 */
@Injectable()
export class ServiceFeedbackService {
  private readonly logger = new Logger(ServiceFeedbackService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly discipline: DisciplineService,
    private readonly employeeReports: EmployeeReportsService,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /**
   * Servicios del cliente terminados dentro del plazo, con lo que ya valoro.
   *
   * En un servicio grupal se califica a cada participante por separado; en uno
   * individual, a la modelo del servicio. Por eso la lista
   * sale por modelo y se agrupa por servicio aqui.
   */
  async pendientes(
    usuarioId: string,
    empleadaId?: string,
  ): Promise<ServicioPorValorar[]> {
    const clienteId = await this.resolverClienteId(usuarioId);
    const filas: FilaPorValorar[] = await this.dataSource.query(
      `WITH recientes AS (
         SELECT s.id, s.hora_fin_servicio, s.service_type, s.empleada_id
         FROM servicios s
         WHERE s.cliente_id = $1
           AND s.estado = 'finalizado'
           AND s.deleted_at IS NULL
           AND s.hora_fin_servicio > now() - ($2::int * interval '1 millisecond')
           AND s.hora_fin_servicio <= now()
           AND ($3::uuid IS NULL OR s.empleada_id = $3::uuid)
         ORDER BY s.hora_fin_servicio DESC
         LIMIT $4
       )
       SELECT r.id                AS servicio_id,
              r.hora_fin_servicio AS finalizado_en,
              r.service_type      AS service_type,
              e.id                AS empleada_id,
              e.nombre_artistico  AS nombre_artistico,
              ir.stars            AS estrellas,
              (SELECT array_agg(DISTINCT er.category::text)
                 FROM employee_reports er
                WHERE er.service_id = r.id
                  AND er.reporter_key = 'cliente:' || $1::text
              )                   AS categorias_reportadas
       FROM recientes r
       JOIN LATERAL (
         SELECT r.empleada_id AS employee_id
          WHERE r.service_type <> 'grupal'
         UNION
         SELECT p.employee_id
           FROM service_participants p
          WHERE r.service_type = 'grupal'
            AND p.service_id = r.id
            AND p.status <> 'cancelada'
       ) m ON true
       JOIN empleadas e ON e.id = m.employee_id
       LEFT JOIN interaction_ratings ir
              ON ir.direction = 'client_to_employee'
             AND ir.service_id = r.id
             AND ir.employee_id = m.employee_id
       ORDER BY r.hora_fin_servicio DESC, r.id, e.nombre_artistico`,
      [
        clienteId,
        VENTANA_DE_VALORACION_MS,
        empleadaId ?? null,
        MAX_SERVICIOS_POR_VALORAR,
      ],
    );
    return agruparPorServicio(filas);
  }

  /**
   * Califica un servicio propio. Idempotente: repetir la peticion (doble toque,
   * reintento de red) devuelve la primera calificacion con `creada: false` y
   * no duplica sus efectos disciplinarios.
   */
  async calificar(
    usuarioId: string,
    servicioId: string,
    dto: CalificarServicioDto,
  ): Promise<{ calificacion: CalificacionDelCliente; creada: boolean }> {
    const clienteId = await this.resolverClienteId(usuarioId);
    const comentario =
      dto.comentario ??
      (dto.motivo ? ETIQUETAS_DE_MOTIVO[dto.motivo] : undefined);

    const { rating, created } =
      await this.discipline.createClientRatingIdempotent(clienteId, {
        direction: 'client_to_employee',
        interactionId: servicioId,
        employeeId: dto.empleadaId,
        stars: dto.estrellas,
        comment: comentario,
      });

    if (created && rating.employeeId) {
      await this.reflejarEnElServicio(
        servicioId,
        rating.employeeId,
        rating.stars,
      );
    } else if (dto.motivo && !rating.comment && !dto.empleadaId) {
      // El motivo puede llegar despues de las estrellas, y
      // solo se guarda si todavia no hay comentario. En un grupal no se usa
      // porque `addClientRatingReason` no distingue participantes.
      await this.discipline.addClientRatingReason(
        clienteId,
        servicioId,
        dto.motivo,
      );
    }

    return {
      calificacion: {
        servicioId,
        empleadaId: rating.employeeId,
        estrellas: rating.stars,
      },
      creada: created,
    };
  }

  /** Reporte del cliente sobre la modelo de un servicio suyo. */
  async reportar(
    usuarioId: string,
    servicioId: string,
    dto: ReportarServicioDto,
  ): Promise<ReporteRecibido> {
    const reporte = await this.employeeReports.createFromClientAccount(
      usuarioId,
      servicioId,
      dto.categoria,
      dto.descripcion,
    );
    return {
      id: reporte.id,
      categoria: reporte.category,
      creadoEn: reporte.createdAt,
    };
  }

  /** Reporte del chofer sobre la modelo de un viaje suyo. */
  async reportarDesdeElChofer(
    usuarioId: string,
    dto: ReportarViajeDto,
  ): Promise<ReporteRecibido> {
    const reporte = await this.employeeReports.createFromDriverAccount(
      usuarioId,
      dto.viajeId,
      dto.categoria,
      dto.descripcion,
    );
    return {
      id: reporte.id,
      categoria: reporte.category,
      creadoEn: reporte.createdAt,
    };
  }

  /**
   * Vuelve a contratar a la modelo de un servicio terminado.
   *
   * Una conversacion web es una reserva: al aceptarse queda `con_servicio` y
   * la IA deja de contestar, asi que el chat del servicio anterior no sirve
   * para pedir otro. Se cierra --solo si sigue colgada de este servicio-- y se
   * abre una nueva con la misma modelo; el historial queda intacto. Es una
   * sesion limpia en la que solo viaja la intencion de contratar a la misma modelo.
   *
   * Si ya hay otro chat abierto con ella (una reserva nueva en curso, u otro
   * servicio todavia vivo) no se toca y se devuelve ese.
   */
  async volverAContratar(
    usuarioId: string,
    servicioId: string,
  ): Promise<{ conversation: ResumenDeConversacion; creada: boolean }> {
    const clienteId = await this.resolverClienteId(usuarioId);
    const filas: Array<{ empleada_id: string; estado: string }> =
      await this.dataSource.query(
        `SELECT empleada_id, estado::text AS estado
         FROM servicios
         WHERE id = $1 AND cliente_id = $2 AND deleted_at IS NULL`,
        [servicioId, clienteId],
      );
    const servicio = filas[0];
    // Ajeno responde igual que inexistente, para no revelar que existe.
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    if (servicio.estado !== 'finalizado') {
      throw new ConflictException(
        'Solo se puede volver a contratar un servicio finalizado',
      );
    }

    const cerradas: Array<{ id: string }> = await this.dataSource.query(
      `WITH cerrada AS (
         UPDATE conversations
            SET status = 'cerrada', updated_at = now()
          WHERE client_id = $1
            AND employee_id = $2
            AND service_id = $3
            AND status = 'con_servicio'
         RETURNING id
       )
       SELECT id FROM cerrada`,
      [clienteId, servicio.empleada_id, servicioId],
    );
    for (const { id } of cerradas) {
      this.anunciarCierre(clienteId, id);
    }

    return this.conversations.openWithEmployee(usuarioId, servicio.empleada_id);
  }

  private async resolverClienteId(usuarioId: string): Promise<string> {
    const filas: Array<{ id: string }> = await this.dataSource.query(
      'SELECT id FROM clientes WHERE usuario_id = $1',
      [usuarioId],
    );
    if (!filas[0]) {
      throw new NotFoundException('Esta cuenta no tiene ficha de cliente');
    }
    return filas[0].id;
  }

  /**
   * Copia las estrellas a `servicios.calificacion`. Solo la
   * modelo principal: en un grupal cada participante tiene su propia fila en
   * `interaction_ratings` y el servicio solo guarda una cifra. Condicionado a
   * que este vacia para que una carrera no pise la primera.
   */
  private async reflejarEnElServicio(
    servicioId: string,
    empleadaId: string,
    estrellas: number,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE servicios
          SET calificacion = $3
        WHERE id = $1 AND empleada_id = $2 AND calificacion IS NULL`,
      [servicioId, empleadaId, estrellas],
    );
  }

  /**
   * Las otras pestañas del cliente dejan de mostrar el chat como vigente. Un
   * fallo aqui no deshace el cierre: el navegador lo ve al recargar.
   */
  private anunciarCierre(clienteId: string, conversationId: string): void {
    try {
      this.realtime.emitToClient(clienteId, {
        type: CONVERSATION_STATUS_CHANGED,
        data: { conversationId, status: 'cerrada' },
      } satisfies ConversationStatusChangedEvent);
    } catch (error) {
      this.logger.warn(
        `No se pudo anunciar el cierre de la conversacion ${conversationId}: ${describeError(error)}`,
      );
    }
  }
}

/** Una fila por modelo pasa a un elemento por servicio, en el mismo orden. */
export function agruparPorServicio(
  filas: FilaPorValorar[],
): ServicioPorValorar[] {
  const porServicio = new Map<string, ServicioPorValorar>();
  for (const fila of filas) {
    let servicio = porServicio.get(fila.servicio_id);
    if (!servicio) {
      servicio = {
        servicioId: fila.servicio_id,
        finalizadoEn: new Date(fila.finalizado_en),
        grupal: fila.service_type === 'grupal',
        modelos: [],
        categoriasReportadas: fila.categorias_reportadas ?? [],
      };
      porServicio.set(fila.servicio_id, servicio);
    }
    servicio.modelos.push({
      id: fila.empleada_id,
      nombreArtistico: fila.nombre_artistico,
      estrellas: fila.estrellas == null ? null : Number(fila.estrellas),
    });
  }
  return [...porServicio.values()];
}
