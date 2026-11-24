import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { BookingModule } from '../booking/booking.module';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import { PaymentReceiptValidations } from '../services/entities/payment-receipt-validation.entity';
import { Servicios } from '../services/entities/service.entity';
import { ServicesModule } from '../services/services.module';
import { CustomerBookingSession } from '../booking/entities/customer-booking-session.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadModule } from '../upload/upload.module';
import { StaffConversationsController } from './staff-conversations.controller';
import { StaffConversationsService } from './staff-conversations.service';
import { ConversationReceiptsService } from './conversation-receipts.service';
import { ConversationNotifierModule } from './conversation-notifier.module';
import { CONVERSATION_TURN_HANDLER } from './conversation-turn-handler';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { WebBookingStateStore } from './web-booking-state.store';
import { WebTurnHandler } from './web-turn-handler';

// `RealtimeEventsService` llega por `RealtimeModule`, que es global. El turno
// de la IA es `WebTurnHandler`, registrado bajo `CONVERSATION_TURN_HANDLER`;
// `BookingModule` no conoce a este modulo, asi que no hay ciclo.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      Clientes,
      Empleadas,
      // Comprobantes del chat web: se leen y escriben las entidades, sin
      // importar `ServicesModule`, que ya importa el notificador de aqui.
      Servicios,
      PaymentReceiptValidations,
      AuthorizedBankAccounts,
      // El borrador que aceptan o rechazan los jefes desde la bandeja.
      CustomerBookingSession,
    ]),
    ConversationNotifierModule,
    BookingModule,
    AiModule,
    UploadModule,
    // El aviso push al jefe cuando el cliente manda una foto o un audio.
    NotificationsModule,
    // Aceptar el borrador crea el servicio con `ServicesService`. Sin ciclo:
    // `ServicesModule` importa el notificador, no este modulo.
    ServicesModule,
  ],
  controllers: [ConversationsController, StaffConversationsController],
  providers: [
    ConversationsService,
    ConversationReceiptsService,
    StaffConversationsService,
    WebBookingStateStore,
    WebTurnHandler,
    { provide: CONVERSATION_TURN_HANDLER, useExisting: WebTurnHandler },
  ],
  // El notificador se reexporta; `ServicesModule` importa su modulo directo.
  exports: [ConversationsService, ConversationNotifierModule],
})
export class ConversationsModule {}
