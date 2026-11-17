import {
  Body,
  Controller,
  Get,
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
import {
  ConversationsService,
  MensajeDelChat,
  PaginaDeMensajes,
  ResumenDeConversacion,
} from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Chat web visto por el cliente. Las rutas del jefe (toma de control,
 * respuesta humana) iran en su propio controlador: aqui todo es `cliente`.
 *
 * Abrir un chat y enviar un mensaje responden 201 cuando crean algo y 200
 * cuando devuelven lo que ya existia (chat abierto o reintento del mismo
 * `clientMessageId`), para que el navegador distinga ambos casos sin otro
 * campo en el cuerpo.
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('cliente')
  list(@GetUser() actor: Usuarios): Promise<ResumenDeConversacion[]> {
    return this.conversationsService.listForClient(actor.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  async open(
    @GetUser() actor: Usuarios,
    @Body() dto: CreateConversationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResumenDeConversacion> {
    const { conversation, creada } =
      await this.conversationsService.openWithEmployee(
        actor.id,
        dto.employeeId,
      );
    res.status(creada ? HttpStatus.CREATED : HttpStatus.OK);
    return conversation;
  }

  @Get(':id/messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('cliente')
  listMessages(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesDto,
  ): Promise<PaginaDeMensajes> {
    return this.conversationsService.listMessages(actor.id, id, query);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/messages')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  async sendMessage(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MensajeDelChat> {
    const { message, creado } =
      await this.conversationsService.sendClientMessage(actor.id, id, dto);
    res.status(creado ? HttpStatus.CREATED : HttpStatus.OK);
    return message;
  }
}
