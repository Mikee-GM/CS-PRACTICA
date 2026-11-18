import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { Usuarios } from '../users/entities/user.entity';
import { CandidateScreeningController } from './candidate-screening.controller';
import { CandidateScreeningPublicController } from './candidate-screening-public.controller';
import { CandidateScreeningService } from './candidate-screening.service';
import { CandidateScreening } from './entities/candidate-screening.entity';
import { CandidateScreeningAnswer } from './entities/candidate-screening-answer.entity';
import { ScreeningQuestion } from './entities/screening-question.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScreeningQuestion,
      CandidateScreening,
      CandidateScreeningAnswer,
      Usuarios,
    ]),
    NotificationsModule,
  ],
  // El publico va primero por claridad; sus rutas tienen dos segmentos y no
  // chocan con `GET candidate-screening/:id` del admin.
  controllers: [
    CandidateScreeningPublicController,
    CandidateScreeningController,
  ],
  providers: [CandidateScreeningService],
  exports: [CandidateScreeningService],
})
export class CandidateScreeningModule {}
