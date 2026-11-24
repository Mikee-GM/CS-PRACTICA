import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Usuarios } from '../users/entities/user.entity';
import {
  BeneficioDeInstalacion,
  ClientBenefitsService,
} from './client-benefits.service';

/** Beneficios del cliente con sesion. Todo es del propio cliente, nunca de otro. */
@Controller('client-benefits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('cliente')
export class ClientBenefitsController {
  constructor(private readonly beneficios: ClientBenefitsService) {}

  @Get('app-install')
  estado(@GetUser() actor: Usuarios): Promise<BeneficioDeInstalacion> {
    return this.beneficios.estadoDeInstalacion(actor.id);
  }

  /** Se llama al abrir la app instalada con sesion; repetirlo no cambia nada. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('app-install')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  reclamar(@GetUser() actor: Usuarios): Promise<BeneficioDeInstalacion> {
    return this.beneficios.reclamarPorInstalacion(actor.id);
  }
}
