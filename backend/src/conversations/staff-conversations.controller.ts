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
import { Usuarios } from '../users/entities/user.entity';
import { ListMessagesDto } from './dto/list-messages.dto';
import {
  ListStaffConversationsDto,
  RejectBookingDraftDto,
  ReleaseConversationDto,
  SendStaffMessageDto,
  TakeOverConversationDto,
} from './dto/staff-conversations.dto';
import {
  ConversacionDelEquipo,
  ControlDeConversacion,
  DecisionSobreBorrador,
  MensajeParaElEquipo,
  StaffConversationsService,
} from './staff-conversations.service';

/**
 * Chat web visto por el equipo. Aparte del controlador del cliente, que solo
 * admite `cliente`: aqui todo es `admin` o `jefe`, y el alcance de cada jefe
 * (que conversaciones le tocan) lo decide el servicio, que responde 404 fuera
 * de el.
 *
 * Tomar, devolver, aceptar y rechazar responden 200 aunque sean POST: no crean
 * un recurso. Enviar un mensaje responde 201 nuevo y 200 en el reintento del
 * mismo `clientMessageId`, como en el chat del cliente.
 */
@Controller('staff/conversations')
export class StaffConversationsController {
  constructor(private readonly staffService: StaffConversationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  list(
    @GetUser() actor: Usuarios,
    @Query() query: ListStaffConversationsDto,
  ): Promise<ConversacionDelEquipo[]> {
    return this.staffService.listar(actor, query);
  }

  @Get(':id/messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  listMessages(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesDto,
  ): Promise<{ items: MensajeParaElEquipo[]; nextCursor: string | null }> {
    return this.staffService.listarMensajes(actor, id, query);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/take-over')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  takeOver(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TakeOverConversationDto,
  ): Promise<ControlDeConversacion> {
    return this.staffService.tomarControl(actor, id, dto.forzar);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  release(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseConversationDto,
  ): Promise<ControlDeConversacion> {
    return this.staffService.liberar(actor, id, dto.forzar);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/messages')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  async sendMessage(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendStaffMessageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MensajeParaElEquipo> {
    const { message, creado } = await this.staffService.enviarMensaje(
      actor,
      id,
      dto,
    );
    res.status(creado ? HttpStatus.CREATED : HttpStatus.OK);
    return message;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  accept(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DecisionSobreBorrador> {
    return this.staffService.aceptar(actor, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  reject(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectBookingDraftDto,
  ): Promise<DecisionSobreBorrador> {
    return this.staffService.rechazar(actor, id, dto.motivo);
  }
}
