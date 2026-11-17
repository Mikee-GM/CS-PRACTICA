import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { DisciplineModule } from '../discipline/discipline.module';
import { EmployeeReportsModule } from '../employee-reports/employee-reports.module';
import { ClientServiceFeedbackController } from './client-service-feedback.controller';
import { PortalServiceFeedbackController } from './portal-service-feedback.controller';
import { ServiceFeedbackService } from './service-feedback.service';

// `RealtimeEventsService` llega por `RealtimeModule`, que es global. Ninguno
// de los tres modulos importa este, asi que no hay ciclo.
@Module({
  imports: [DisciplineModule, EmployeeReportsModule, ConversationsModule],
  controllers: [
    ClientServiceFeedbackController,
    PortalServiceFeedbackController,
  ],
  providers: [ServiceFeedbackService],
})
export class ServiceFeedbackModule {}
