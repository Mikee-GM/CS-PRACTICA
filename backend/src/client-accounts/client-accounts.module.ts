import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clientes } from '../clients/entities/client.entity';
import { Usuarios } from '../users/entities/user.entity';
import { ClientAccountsController } from './client-accounts.controller';
import { ClientAccountsService } from './client-accounts.service';
import { VerificacionCorreo } from './entities/email-verification.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Usuarios, Clientes, VerificacionCorreo])],
  controllers: [ClientAccountsController],
  providers: [ClientAccountsService],
  exports: [ClientAccountsService],
})
export class ClientAccountsModule {}
