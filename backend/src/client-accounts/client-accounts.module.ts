import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Usuarios } from '../users/entities/user.entity';
import { ClientAccountsController } from './client-accounts.controller';
import { ClientAccountsService } from './client-accounts.service';
import { VerificacionCorreo } from './entities/email-verification.entity';
import { NivelDelClienteService } from './nivel-del-cliente.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Usuarios,
      Clientes,
      VerificacionCorreo,
      AuthSession,
    ]),
  ],
  controllers: [ClientAccountsController],
  providers: [ClientAccountsService, NivelDelClienteService],
  exports: [ClientAccountsService],
})
export class ClientAccountsModule {}
