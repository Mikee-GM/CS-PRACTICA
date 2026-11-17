import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { ExtrasServicio } from '../service-extras/entities/service-extra.entity';
import { ServicesService } from '../services/services.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { BookingAiService } from '../booking/booking-ai.service';

@Injectable()
export class TelegramBookingService {
  private readonly logger = new Logger(TelegramBookingService.name);

  constructor(
    @InjectRepository(Usuarios)
    readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Servicios)
    readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(ExtrasCatalogo)
    readonly extrasCatalogoRepository: Repository<ExtrasCatalogo>,
    @InjectRepository(ExtrasServicio)
    readonly extrasServicioRepository: Repository<ExtrasServicio>,
    @Inject(forwardRef(() => ServicesService))
    readonly servicesService: ServicesService,
    readonly loyaltyService: LoyaltyService,
    private readonly bookingAiService: BookingAiService,
  ) {}

  /**
   * Llamada a la IA de la conversacion de reserva por Telegram.
   *
   * La llamada y el contador viven en `BookingAiService`, que identifica al
   * cliente por su id; aqui solo se traduce el chat de Telegram a ese id. El
   * limite diario no se aplica en este canal (ver `OpcionesDeLlamadaIa`), asi
   * que Telegram sigue contando las llamadas sin cortar ninguna, como antes.
   */
  async getGroqResponse(
    systemPrompt: string,
    history: { role: 'user' | 'model'; parts: { text: string }[] }[],
    clientTelegramId?: string,
  ): Promise<string> {
    let clienteId: string | undefined;
    if (clientTelegramId) {
      try {
        const client = await this.clientesRepository.findOne({
          where: { telegramChatId: clientTelegramId },
          select: { id: true },
        });
        clienteId = client?.id;
      } catch (err) {
        this.logger.warn(
          'Error registrando llamada de IA para el cliente:',
          err,
        );
      }
    }

    return this.bookingAiService.callModel(systemPrompt, history, {
      clienteId,
      aplicarLimiteDiario: false,
    });
  }
}
