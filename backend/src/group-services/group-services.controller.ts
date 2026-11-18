import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Usuarios } from '../users/entities/user.entity';
import {
  AddGroupParticipantDto,
  ChangeGroupDurationDto,
  ChangeGroupResponsibleDto,
  ConfigureGroupTransportDto,
  ConfirmGroupQuoteDto,
  CreateGroupRequestDto,
  CreateGroupRequestFromConversationDto,
  ManualTransportChargeDto,
  GroupRequestMessageDto,
  RegisterGroupPaymentDto,
  RemoveGroupParticipantDto,
  ReserveGroupSelectionDto,
  ReviewReceiptDto,
  UpdateGroupRequestDto,
} from './dto/group-service.dto';
import { GroupServicesService } from './group-services.service';

/*
 * `CsrfGuard` a nivel de clase: deja pasar GET y exige el token en todo lo que
 * escribe. Antes de la Fase 5 estas rutas no lo pedian; el panel ya lo manda
 * siempre (`apiFetch`).
 */
@Controller('group-services')
@UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
@Roles('admin', 'jefe')
export class GroupServicesController {
  constructor(private readonly groupServices: GroupServicesService) {}

  @Get('candidates')
  candidates(@Req() req: any) {
    return this.groupServices.availableEmployees(req.user);
  }

  @Get('requests')
  findAll(@Req() req: any) {
    return this.groupServices.findAll(req.user);
  }

  @Post('requests')
  create(@Body() dto: CreateGroupRequestDto, @Req() req: any) {
    return this.groupServices.create(dto, req.user);
  }

  /** Conversaciones del chat web que piden un grupo y aun no tienen solicitud. */
  @Get('chat-requests')
  pendingConversations(@GetUser() actor: Usuarios) {
    return this.groupServices.pendingConversations(actor);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('requests/from-conversation')
  createFromConversation(
    @Body() dto: CreateGroupRequestFromConversationDto,
    @GetUser() actor: Usuarios,
  ) {
    return this.groupServices.createFromConversation(dto.conversationId, actor);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('requests/:id/location-from-chat')
  @HttpCode(HttpStatus.OK)
  useChatLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() actor: Usuarios,
  ) {
    return this.groupServices.useChatLocation(id, actor);
  }

  @Get('requests/:id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.groupServices.findOne(id, req.user);
  }

  @Get('requests/:id/messages')
  messages(@Param('id') id: string, @Req() req: any) {
    return this.groupServices.requestMessages(id, req.user);
  }

  @Post('requests/:id/messages')
  sendMessage(
    @Param('id') id: string,
    @Body() dto: GroupRequestMessageDto,
    @Req() req: any,
  ) {
    return this.groupServices.sendRequestMessage(id, dto.message, req.user);
  }

  @Patch('requests/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGroupRequestDto,
    @Req() req: any,
  ) {
    return this.groupServices.updateRequest(id, dto, req.user);
  }

  @Post('requests/:id/catalog')
  openCatalog(@Param('id') id: string, @Req() req: any) {
    return this.groupServices.openCatalog(id, req.user);
  }

  @Post('requests/:id/request-location')
  requestLocation(@Param('id') id: string, @Req() req: any) {
    return this.groupServices.requestClientLocation(id, req.user);
  }

  @Put('requests/:id/selections')
  reserve(
    @Param('id') id: string,
    @Body() dto: ReserveGroupSelectionDto,
    @Req() req: any,
  ) {
    return this.groupServices.reserveSelections(id, dto, req.user);
  }

  @Post('requests/:id/extend-hold')
  extendHold(@Param('id') id: string, @Req() req: any) {
    return this.groupServices.extendHold(id, req.user);
  }

  @Post('requests/:id/confirm-quote')
  confirmQuote(
    @Param('id') id: string,
    @Body() dto: ConfirmGroupQuoteDto,
    @Req() req: any,
  ) {
    return this.groupServices.confirmQuote(id, dto, req.user);
  }

  @Delete('requests/:id')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.groupServices.cancelRequest(id, req.user);
  }

  @Get('services/:serviceId')
  findService(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.groupServices.findService(serviceId, req.user);
  }

  @Post('services/:serviceId/payments')
  registerPayment(
    @Param('serviceId') serviceId: string,
    @Body() dto: RegisterGroupPaymentDto,
    @Req() req: any,
  ) {
    return this.groupServices.registerPayment(serviceId, dto, req.user);
  }

  @Patch('receipts/:validationId/review')
  reviewReceipt(
    @Param('validationId') validationId: string,
    @Body() dto: ReviewReceiptDto,
    @Req() req: any,
  ) {
    return this.groupServices.reviewReceipt(
      validationId,
      dto.decision,
      req.user,
      dto.reason,
    );
  }

  @Post('services/:serviceId/start')
  start(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.groupServices.start(serviceId, req.user);
  }

  @Post('services/:serviceId/cancel')
  cancelService(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.groupServices.cancelService(serviceId, req.user);
  }

  @Post('services/:serviceId/participants')
  addParticipant(
    @Param('serviceId') serviceId: string,
    @Body() dto: AddGroupParticipantDto,
    @Req() req: any,
  ) {
    return this.groupServices.addParticipant(serviceId, dto, req.user);
  }

  @Delete('services/:serviceId/participants/:employeeId')
  removeParticipant(
    @Param('serviceId') serviceId: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: RemoveGroupParticipantDto,
    @Req() req: any,
  ) {
    return this.groupServices.removeParticipant(
      serviceId,
      employeeId,
      dto,
      req.user,
    );
  }

  @Put('services/:serviceId/responsible')
  changeResponsible(
    @Param('serviceId') serviceId: string,
    @Body() dto: ChangeGroupResponsibleDto,
    @Req() req: any,
  ) {
    return this.groupServices.changeResponsible(serviceId, dto, req.user);
  }

  @Patch('services/:serviceId/duration')
  changeDuration(
    @Param('serviceId') serviceId: string,
    @Body() dto: ChangeGroupDurationDto,
    @Req() req: any,
  ) {
    return this.groupServices.changeDuration(serviceId, dto, req.user);
  }

  @Put('services/:serviceId/transports')
  configureTransports(
    @Param('serviceId') serviceId: string,
    @Body() dto: ConfigureGroupTransportDto,
    @Req() req: any,
  ) {
    return this.groupServices.configureTransports(serviceId, dto, req.user);
  }

  @Post('services/:serviceId/manual-transport-charge')
  addManualTransportCharge(
    @Param('serviceId') serviceId: string,
    @Body() dto: ManualTransportChargeDto,
    @Req() req: any,
  ) {
    return this.groupServices.addManualTransportCharge(
      serviceId,
      dto,
      req.user,
    );
  }
}
