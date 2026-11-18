import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { AuthorizedBankAccounts } from '../services/entities/authorized-bank-account.entity';
import { CustomerBookingSession } from './entities/customer-booking-session.entity';
import { TransportOperationsModule } from '../transport-operations/transport-operations.module';
import { BookingAiService } from './booking-ai.service';
import { BookingService } from './booking.service';

/**
 * Dominio de reserva, independiente del canal.
 *
 * No importa nada de Telegram a proposito: tanto el bot como el chat web lo
 * usan, y si dependiera del bot la web arrastraria Telegraf para reservar.
 * `CustomerBookingSession` es solo la entidad del borrador; el servicio de
 * Telegram que tambien la escribe no se importa.
 */
@Module({
  imports: [
    ConfigModule,
    AiModule,
    TransportOperationsModule,
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
