import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingModule } from '../booking/booking.module';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
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
    TypeOrmModule.forFeature([Conversation, Message, Clientes, Empleadas]),
    ConversationNotifierModule,
    BookingModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    WebBookingStateStore,
    WebTurnHandler,
    { provide: CONVERSATION_TURN_HANDLER, useExisting: WebTurnHandler },
  ],
  // El notificador se reexporta; `ServicesModule` importa su modulo directo.
  exports: [ConversationsService, ConversationNotifierModule],
})
export class ConversationsModule {}
