import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { Usuarios } from './entities/user.entity';
import { UserSeederService } from './user-seeder.service';
import { WorkShiftStatusService } from './work-shift-status.service';
import { WorkShiftResetScheduler } from './work-shift-reset.scheduler';
import { CuentaDelPersonalService } from './cuenta-del-personal.service';
import { Empleadas } from '../employees/entities/employee.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuarios, Empleadas]),
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserSeederService,
    WorkShiftStatusService,
    WorkShiftResetScheduler,
    CuentaDelPersonalService,
  ],
  exports: [UsersService, WorkShiftStatusService],
})
export class UsersModule {}
