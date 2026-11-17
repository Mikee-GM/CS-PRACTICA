import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Usuarios } from '../users/entities/user.entity';
import { ClientAccountsService } from './client-accounts.service';
import { VerifyEmailDto } from './dto/verify-email.dto';

/**
 * El registro vive en `AuthController` (`POST /auth/register`) porque abre
 * sesion y las cookies se emiten alli. Aqui queda lo que hace la cuenta ya
 * creada.
 */
@Controller('client-accounts')
export class ClientAccountsController {
  constructor(private readonly clientAccountsService: ClientAccountsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('cliente')
  me(@GetUser() actor: Usuarios) {
    return this.clientAccountsService.me(actor.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.clientAccountsService.verify(dto.token);
  }

  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('resend-verification')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(@GetUser() actor: Usuarios): Promise<void> {
    await this.clientAccountsService.resend(actor.id);
  }
}
