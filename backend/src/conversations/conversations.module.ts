import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

// Por ahora solo registra las tablas del chat web; el servicio, el
// controlador y el SSE llegan en los pasos siguientes de la fase 2.
@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message])],
})
export class ConversationsModule {}
