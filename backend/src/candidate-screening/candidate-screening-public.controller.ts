import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AvanceDeCandidata,
  CandidateScreeningService,
  EvaluacionPublica,
} from './candidate-screening.service';
import { ResponderEvaluacionDto } from './dto/candidate-screening.dto';

/**
 * La evaluacion de una candidata, sin Telegram y sin sesion.
 *
 * Publica a proposito: la candidata todavia no tiene cuenta, y la unica
 * credencial es el token de su enlace. Por eso no lleva `JwtAuthGuard`,
 * `RolesGuard` ni `@Roles`, y tampoco `CsrfGuard`: un sitio ajeno que quisiera
 * forzar una respuesta necesitaria el token, que es justo lo que no tiene.
 *
 * El token lleva 72 bits aleatorios, asi que adivinarlo no es viable; el limite
 * frena el abuso de la ruta. Es holgado porque el trafico anonimo llega por el
 * proxy de Next y `HttpThrottlerGuard` lo cuenta casi todo junto: un cupo
 * estrecho lo agotarian entre varias candidatas contestando a la vez.
 */
@ApiTags('candidate-screening')
@Controller('candidate-screening/public')
export class CandidateScreeningPublicController {
  constructor(private readonly service: CandidateScreeningService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: 'Consultar la evaluacion por su enlace' })
  ver(@Param('token') token: string): Promise<EvaluacionPublica> {
    return this.service.evaluacionPublica(token);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':token/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Responder la pregunta en curso' })
  responder(
    @Param('token') token: string,
    @Body() dto: ResponderEvaluacionDto,
  ): Promise<AvanceDeCandidata> {
    return this.service.responderPublica(token, dto);
  }
}
