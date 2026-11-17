import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { ResumenDeConversacion } from '../conversations/conversations.service';
import { Usuarios } from '../users/entities/user.entity';
import {
  CalificarServicioDto,
  PendientesDeValorarQueryDto,
  ReportarServicioDto,
} from './dto/service-feedback.dto';
import {
  CalificacionDelCliente,
  ReporteRecibido,
  ServiceFeedbackService,
  ServicioPorValorar,
} from './service-feedback.service';

/**
 * Lo que el cliente hace con un servicio terminado desde el chat web:
 * calificarlo, reportarlo y volver a contratar a la misma modelo. Sustituye a
 * los botones que el bot mandaba al cerrar el servicio.
 *
 * Calificar y volver a contratar responden 201 cuando crean algo y 200 cuando
 * devuelven lo que ya existia, como el resto del chat.
 */
@Controller('client-feedback')
export class ClientServiceFeedbackController {
  constructor(private readonly feedback: ServiceFeedbackService) {}

  @Get('pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('cliente')
  pendientes(
    @GetUser() actor: Usuarios,
    @Query() query: PendientesDeValorarQueryDto,
  ): Promise<ServicioPorValorar[]> {
    return this.feedback.pendientes(actor.id, query.empleadaId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('services/:serviceId/rating')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  async calificar(
    @GetUser() actor: Usuarios,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: CalificarServicioDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CalificacionDelCliente> {
    const { calificacion, creada } = await this.feedback.calificar(
      actor.id,
      serviceId,
      dto,
    );
    res.status(creada ? HttpStatus.CREATED : HttpStatus.OK);
    return calificacion;
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('services/:serviceId/report')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  @HttpCode(HttpStatus.CREATED)
  reportar(
    @GetUser() actor: Usuarios,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: ReportarServicioDto,
  ): Promise<ReporteRecibido> {
    return this.feedback.reportar(actor.id, serviceId, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('services/:serviceId/rehire')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  async volverAContratar(
    @GetUser() actor: Usuarios,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResumenDeConversacion> {
    const { conversation, creada } = await this.feedback.volverAContratar(
      actor.id,
      serviceId,
    );
    res.status(creada ? HttpStatus.CREATED : HttpStatus.OK);
    return conversation;
  }
}
