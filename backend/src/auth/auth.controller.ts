import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ClientAccountsService } from '../client-accounts/client-accounts.service';
import { RegisterClientDto } from '../client-accounts/dto/register-client.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CsrfGuard } from './guards/csrf.guard';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  clearCookieOptions,
  cookieOptions,
  CSRF_COOKIE,
  csrfCookieOptions,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants';
import {
  ApiControllerDocs,
  ApiLoginDocs,
} from '../common/swagger/api-docs.decorators';
import { Usuarios } from '../users/entities/user.entity';

@Controller('auth')
@ApiControllerDocs('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly clientAccountsService: ClientAccountsService,
  ) {}

  // Limite estricto: el global de 100/min no sirve de nada contra fuerza bruta
  // de credenciales.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiLoginDocs(LoginDto)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const deviceId =
      request.headers['x-device-id']?.toString().slice(0, 128) ||
      request.headers['user-agent']?.slice(0, 128) ||
      'unknown';
    const result = await this.authService.login(loginDto, deviceId);
    this.setAuthCookies(response, result);
    return { user: result.user };
  }

  /**
   * Alta de una cuenta de cliente. Abre sesion al terminar: la verificacion del
   * correo queda pendiente y no bloquea el acceso.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterClientDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const usuario = await this.clientAccountsService.register(dto);
    const deviceId =
      request.headers['x-device-id']?.toString().slice(0, 128) ||
      request.headers['user-agent']?.slice(0, 128) ||
      'unknown';
    const result = await this.authService.issueSessionFor(usuario, deviceId);
    this.setAuthCookies(response, result);
    return { user: result.user };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.signedCookies?.[REFRESH_COOKIE] as
      string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('No existe una sesión renovable');
    }
    const csrfCookie = request.cookies?.[CSRF_COOKIE] as string | undefined;
    const csrfHeader = request.headers['x-csrf-token'];
    if (
      typeof csrfCookie !== 'string' ||
      typeof csrfHeader !== 'string' ||
      csrfCookie.length !== csrfHeader.length ||
      !timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader))
    ) {
      throw new UnauthorizedException('Token CSRF inválido');
    }

    const result = await this.authService.refresh(refreshToken, csrfCookie);
    this.setAuthCookies(response, result);
    return { user: result.user };
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(
      request.signedCookies?.[ACCESS_COOKIE] as string | undefined,
    );
    this.clearAuthCookies(response);
  }

  /**
   * `debeCambiarPassword` le dice al frontend que muestre el cambio forzado.
   * No es una barrera de seguridad: el resto de la API sigue respondiendo.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: Request) {
    const user = request.user as Usuarios;
    return {
      id: user.id,
      email: user.email,
      rol: user.rol,
      nombre: user.nombre ?? null,
      apellido: user.apellido ?? null,
      debeCambiarPassword: user.debeCambiarPassword ?? false,
    };
  }

  private setAuthCookies(
    response: Response,
    result: {
      accessToken: string;
      refreshToken: string | null;
      csrfToken: string;
    },
  ) {
    response.cookie(
      ACCESS_COOKIE,
      result.accessToken,
      cookieOptions(ACCESS_TOKEN_TTL_SECONDS),
    );
    // Sin refresco nuevo se deja el que ya tiene el navegador: es una
    // renovacion que perdio una carrera y no rotó nada.
    if (result.refreshToken) {
      response.cookie(
        REFRESH_COOKIE,
        result.refreshToken,
        cookieOptions(REFRESH_TOKEN_TTL_SECONDS, REFRESH_COOKIE_PATH),
      );
    }
    if (result.csrfToken) {
      response.cookie(CSRF_COOKIE, result.csrfToken, csrfCookieOptions());
    }
  }

  private clearAuthCookies(response: Response) {
    response.clearCookie(ACCESS_COOKIE, clearCookieOptions());
    response.clearCookie(
      REFRESH_COOKIE,
      clearCookieOptions(REFRESH_COOKIE_PATH),
    );
    const csrfOptions = csrfCookieOptions();
    delete csrfOptions.maxAge;
    response.clearCookie(CSRF_COOKIE, csrfOptions);
  }
}
