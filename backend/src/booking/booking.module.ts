import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import { CustomerBookingSession } from './entities/customer-booking-session.entity';
import { ClientBenefitsModule } from '../client-benefits/client-benefits.module';
import { TransportOperationsModule } from '../transport-operations/transport-operations.module';
import { BookingAiService } from './booking-ai.service';
import { BookingService } from './booking.service';

/**
 * Dominio de reserva, independiente del canal.
 *
 * `CustomerBookingSession` es solo la entidad del borrador.
 */
@Module({
  imports: [
    ConfigModule,
    AiModule,
    TransportOperationsModule,
    ClientBenefitsModule,
    TypeOrmModule.forFeature([
      Clientes,
      Empleadas,
      ExtrasCatalogo,
      CustomerBookingSession,
      // Solo para darle al cliente los datos donde transferir.
      AuthorizedBankAccounts,
    ]),
  ],
  providers: [BookingAiService, BookingService],
  exports: [BookingAiService, BookingService],
})
export class BookingModule {}
