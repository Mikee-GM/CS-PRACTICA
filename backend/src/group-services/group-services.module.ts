import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DisciplineModule } from '../discipline/discipline.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { GroupServicesController } from './group-services.controller';
import { GroupServicesService } from './group-services.service';
import { GroupServiceRequest } from './entities/group-service-request.entity';
import { GroupServiceRequestSelection } from './entities/group-service-request-selection.entity';
import { ServiceGroupAudit } from './entities/service-group-audit.entity';
import { ServiceParticipant } from './entities/service-participant.entity';
import { ServicePayment } from './entities/service-payment.entity';
import { TripPassenger } from './entities/trip-passenger.entity';
import { LiquidationsModule } from '../liquidations/liquidations.module';
import { ServicesModule } from '../services/services.module';
import { GroupBossAssignmentService } from './group-boss-assignment.service';
import { GrupoEnChatWebService } from './grupo-en-chat-web.service';
import { ConversationNotifierModule } from '../conversations/conversation-notifier.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GroupServiceRequest,
      GroupServiceRequestSelection,
      ServiceParticipant,
      ServicePayment,
      ServiceGroupAudit,
      TripPassenger,
      Servicios,
      Empleadas,
      Viajes,
    ]),
    DisciplineModule,
    NotificationsModule,
    LiquidationsModule,
    forwardRef(() => ServicesModule),
    // El chat web del grupo escribe con el notificador, que solo depende de la
    // base: importar `ConversationsModule` cerraria un ciclo con ServicesModule.
    ConversationNotifierModule,
  ],
  controllers: [GroupServicesController],
  providers: [
    GroupServicesService,
    GroupBossAssignmentService,
    GrupoEnChatWebService,
  ],
  exports: [GroupServicesService, GroupBossAssignmentService, TypeOrmModule],
})
export class GroupServicesModule {}
