import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/challenges.dto';

@ApiTags('challenges')
@ApiBearerAuth('jwt')
@Controller('challenges')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  // Antes de ':id': si no, "mine" se tomaria por un uuid. El rol del metodo
  // anula el de clase (RolesGuard usa getAllAndOverride).
  @Get('mine')
  @Roles('empleada', 'chofer')
  mine(@Req() req: any) {
    return this.challenges.misRetos(req.user);
  }

  @Get()
  list(@Req() req: any) {
    return this.challenges.listChallenges(req.user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.challenges.getChallenge(id, req.user);
  }

  @Post()
  create(@Body() dto: CreateChallengeDto, @Req() req: any) {
    return this.challenges.createChallenge(dto, req.user);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.challenges.cancelChallenge(id, req.user);
  }
}
