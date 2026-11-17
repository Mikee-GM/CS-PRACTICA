import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Usuarios } from '../users/entities/user.entity';
import { ListFeedDto } from './dto/list-feed.dto';
import { EstadoDelLike, FeedService, PaginaDelFeed } from './feed.service';

/**
 * Feed de posts visto por el cliente. Todo exige sesion de `cliente` con la
 * declaracion 18+ (la comprueba el servicio): los posts no estan en el
 * catalogo publico.
 *
 * El like es un recurso que existe o no: `PUT` lo crea y `DELETE` lo quita,
 * los dos idempotentes, y ambos devuelven el contador releido de la base.
 */
@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('cliente')
  list(
    @GetUser() actor: Usuarios,
    @Query() query: ListFeedDto,
  ): Promise<PaginaDelFeed> {
    return this.feedService.listFeed(actor.id, query);
  }

  @Get('models/:slug')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('cliente')
  listModel(
    @GetUser() actor: Usuarios,
    @Param('slug') slug: string,
    @Query() query: ListFeedDto,
  ): Promise<PaginaDelFeed> {
    return this.feedService.listModelFeed(actor.id, slug, query);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Put('posts/:id/like')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  like(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EstadoDelLike> {
    return this.feedService.like(actor.id, id);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Delete('posts/:id/like')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('cliente')
  unlike(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EstadoDelLike> {
    return this.feedService.unlike(actor.id, id);
  }
}
