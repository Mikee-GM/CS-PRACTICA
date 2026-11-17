import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { UploadedFilePayload } from '../upload/upload.service';
import { Usuarios } from '../users/entities/user.entity';
import {
  AddPostMediaDto,
  CAMPOS_DE_MEDIA,
  OPCIONES_DE_SUBIDA_DE_MEDIA,
  PostCaptionDto,
  ReorderPostMediaDto,
} from './dto/employee-posts.dto';
import {
  CreateStaffPostDto,
  ListStaffPostsDto,
  RejectPostDto,
} from './dto/staff-posts.dto';
import type { ResultadoDeBorrar } from './posts.service';
import {
  PaginaDelEquipo,
  PostDelEquipo,
  StaffPostsService,
} from './staff-posts.service';

type ArchivosDeMedia = {
  file?: UploadedFilePayload[];
  poster?: UploadedFilePayload[];
};

/**
 * Posts del feed vistos por el equipo: cola de revision, decisiones y
 * publicacion en nombre de una modelo. Todo es `admin` o `jefe`; el alcance de
 * cada jefe lo decide el servicio, que responde 404 fuera de el.
 *
 * Aprobar, rechazar, archivar y publicar responden 200 aunque sean POST: no
 * crean un recurso.
 */
@Controller('staff/posts')
export class StaffPostsController {
  constructor(private readonly staffPosts: StaffPostsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  listar(
    @GetUser() actor: Usuarios,
    @Query() query: ListStaffPostsDto,
  ): Promise<PaginaDelEquipo> {
    return this.staffPosts.listar(actor, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  obtener(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.obtener(actor, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  aprobar(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.aprobar(actor, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  rechazar(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPostDto,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.rechazar(actor, id, dto.motivo);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  archivar(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.archivar(actor, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  crear(
    @GetUser() actor: Usuarios,
    @Body() dto: CreateStaffPostDto,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.crear(actor, {
      employeeId: dto.employeeId,
      caption: dto.caption,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  editar(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostCaptionDto,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.editarCaption(actor, id, dto.caption);
  }

  /**
   * Una foto o un video por peticion, con el mismo multipart que el portal de
   * la modelo (`file`; `poster` si es video; `width`, `height`, `durationMs`).
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/media')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  @UseInterceptors(
    FileFieldsInterceptor(CAMPOS_DE_MEDIA, OPCIONES_DE_SUBIDA_DE_MEDIA),
  )
  agregarMedia(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() archivos: ArchivosDeMedia | undefined,
    @Body() dto: AddPostMediaDto,
  ): Promise<PostDelEquipo> {
    const archivo = archivos?.file?.[0];
    if (!archivo) {
      throw new BadRequestException('Falta el archivo en el campo "file"');
    }
    return this.staffPosts.agregarMedia(actor, id, {
      buffer: archivo.buffer,
      posterBuffer: archivos?.poster?.[0]?.buffer,
      width: dto.width,
      height: dto.height,
      durationMs: dto.durationMs,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Delete(':id/media/:mediaId')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  quitarMedia(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.quitarMedia(actor, id, mediaId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Put(':id/media/order')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  reordenarMedia(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPostMediaDto,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.reordenarMedia(actor, id, dto.ids);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  publicar(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDelEquipo> {
    return this.staffPosts.publicar(actor, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  borrar(
    @GetUser() actor: Usuarios,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResultadoDeBorrar> {
    return this.staffPosts.borrar(actor, id);
  }
}
