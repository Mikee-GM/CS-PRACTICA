import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Usuarios } from '../users/entities/user.entity';
import { ResponderPreguntaDto } from './dto/responder-pregunta.dto';
import {
  AvanceDelCuestionario,
  MiReglamento,
  ReglamentoWebService,
} from './reglamento-web.service';

/**
 * El reglamento y el cuestionario del propio trabajador, sin Telegram.
 *
 * Admin no aparece: no tiene reglamento propio y ya gestiona los de todos desde
 * `EmployeeOnboardingController`.
 */
@ApiTags('staff-onboarding')
@ApiBearerAuth('jwt')
@Controller('staff-onboarding/me')
@UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
@Roles('empleada', 'chofer', 'jefe')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ReglamentoWebController {
  constructor(private readonly reglamentoWeb: ReglamentoWebService) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar el reglamento vigente y el cuestionario propio',
  })
  miReglamento(@GetUser() actor: Usuarios): Promise<MiReglamento> {
    return this.reglamentoWeb.miReglamento(actor.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('questionnaire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Empezar o retomar el cuestionario' })
  empezar(@GetUser() actor: Usuarios): Promise<AvanceDelCuestionario> {
    return this.reglamentoWeb.empezar(actor.id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('questionnaire/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Responder la pregunta en curso' })
  responder(
    @GetUser() actor: Usuarios,
    @Body() dto: ResponderPreguntaDto,
  ): Promise<AvanceDelCuestionario> {
    return this.reglamentoWeb.responder(actor.id, dto.opcionId);
  }
}
