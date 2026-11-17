import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empleadas } from '../employees/entities/employee.entity';
import { ConversationNotifier } from './conversation-notifier';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

/**
 * Modulo propio para el notificador, sin depender de nada mas que la base.
 *
 * `ServicesModule` lo importa directamente en vez de importar
 * `ConversationsModule`: el turno de la IA que se registra en este ultimo
 * acabara creando servicios, y si `ServicesModule` dependiera de el se
 * cerraria un ciclo que solo `forwardRef` desataria. `ConversationsModule` lo
 * reexporta para quien ya lo importa.
 *
 * `RealtimeEventsService` llega por `RealtimeModule`, que es global.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message, Empleadas])],
  providers: [ConversationNotifier],
  exports: [ConversationNotifier],
})
export class ConversationNotifierModule {}
