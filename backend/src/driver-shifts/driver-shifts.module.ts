import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Choferes } from '../drivers/entities/driver.entity';
import { DriverShiftsController } from './driver-shifts.controller';
import { DriverShiftsService } from './driver-shifts.service';
import { DriverShiftAssignment } from './entities/driver-shift-assignment.entity';
import { DriverShift } from './entities/driver-shift.entity';

@Module({
  imports: [
    NotificationsModule,
    TypeOrmModule.forFeature([DriverShift, DriverShiftAssignment, Choferes]),
  ],
  controllers: [DriverShiftsController],
  providers: [DriverShiftsService],
  exports: [DriverShiftsService],
})
export class DriverShiftsModule {}
