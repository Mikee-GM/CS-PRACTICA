import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DisciplineService } from '../discipline/discipline.service';
import { Usuarios } from '../users/entities/user.entity';
import { ReportarViajeDto } from './dto/service-feedback.dto';
import {
  ReporteRecibido,
  ServiceFeedbackService,
} from './service-feedback.service';

/**
 * Las piezas de la valoracion que faltaban en los portales del personal.
 *
 * Viven aqui y no en `EmployeePortalController` / `DriverPortalController`
 * por orden historico: los portales ya entran con la sesion web
 * (`JwtAuthGuard` + rol), igual que este. Las rutas conservan el prefijo de su
 * portal para que el frontend no distinga.
 */
@Controller()
export class PortalServiceFeedbackController {
  constructor(
    private readonly feedback: ServiceFeedbackService,
    private readonly discipline: DisciplineService,
  ) {}

  /** Los viajes recientes de sus servicios cuyo chofer aun no califico. */
  @Get('employee-portal/ratings/pending-drivers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('empleada')
  choferesPorCalificar(@GetUser() actor: Usuarios) {
    return this.discipline.listarChoferesPorCalificar({
      id: actor.id,
      rol: 'empleada',
    });
  }

  /**
   * Reporte del chofer sobre la modelo de un viaje suyo, al sistema de
   * `employee_reports` (el que revisa el admin), no al de conducta. Es la
   * entrada web del boton que el bot ofrecia al cerrar el viaje.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('driver-portal/employee-reports')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('chofer')
  @HttpCode(HttpStatus.CREATED)
  reportarEmpleada(
    @GetUser() actor: Usuarios,
    @Body() dto: ReportarViajeDto,
  ): Promise<ReporteRecibido> {
    return this.feedback.reportarDesdeElChofer(actor.id, dto);
  }
}
