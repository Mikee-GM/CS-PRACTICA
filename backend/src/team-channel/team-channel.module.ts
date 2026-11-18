import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MensajesEquipo } from './entities/team-message.entity';
import { TeamChannelService } from './team-channel.service';
import { TeamChannelController } from './team-channel.controller';
import { Empleadas } from '../employees/entities/employee.entity';
import { Usuarios } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';

/** Canal empleada - jefe. */
@Module({
  imports: [
    TypeOrmModule.forFeature([MensajesEquipo, Empleadas, Usuarios]),
    AuthModule,
    RealtimeModule,
    NotificationsModule,
  ],
  controllers: [TeamChannelController],
  providers: [TeamChannelService],
  exports: [TeamChannelService],
})
export class TeamChannelModule {}
