import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { Clientes } from '../clients/entities/client.entity';
import { BookingAiService } from './booking-ai.service';

/**
 * Dominio de reserva, independiente del canal.
 *
 * No importa nada de Telegram a proposito: tanto el bot como el chat web lo
 * usan, y si dependiera del bot la web arrastraria Telegraf para reservar.
 */
@Module({
  imports: [ConfigModule, AiModule, TypeOrmModule.forFeature([Clientes])],
  providers: [BookingAiService],
  exports: [BookingAiService],
})
export class BookingModule {}
