import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

// `RealtimeEventsService` llega por `RealtimeModule`, que es global. El turno
// de la IA (`CONVERSATION_TURN_HANDLER`) lo registra el paso 6; mientras no
// exista, el servicio guarda y avisa sin responder.
@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, Clientes, Empleadas]),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
