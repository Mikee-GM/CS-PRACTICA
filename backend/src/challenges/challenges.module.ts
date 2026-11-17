import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesScheduler } from './challenges.scheduler';
import { ChallengesService } from './challenges.service';
import { ChallengeParticipant } from './entities/challenge-participant.entity';
import { Challenge } from './entities/challenge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Challenge, ChallengeParticipant]),
    RealtimeModule,
    NotificationsModule,
  ],
  controllers: [ChallengesController],
  providers: [ChallengesService, ChallengesScheduler],
  exports: [ChallengesService],
})
export class ChallengesModule {}
