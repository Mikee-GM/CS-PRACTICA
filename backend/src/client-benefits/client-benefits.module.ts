import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clientes } from '../clients/entities/client.entity';
import { ClientBenefitsController } from './client-benefits.controller';
import { ClientBenefitsService } from './client-benefits.service';
import { BeneficioDeCliente } from './entities/client-benefit.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BeneficioDeCliente, Clientes])],
  controllers: [ClientBenefitsController],
  providers: [ClientBenefitsService],
  exports: [ClientBenefitsService],
})
export class ClientBenefitsModule {}
