import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { PortalUser } from '../auth/decorators/portal-user.decorator';
import { PortalAuthGuard } from '../auth/guards/portal-auth.guard';
import { ApiControllerDocs } from '../common/swagger/api-docs.decorators';
import { EmployeesService } from '../employees/employees.service';
import type { UploadedFilePayload } from '../upload/upload.service';
import {
  AddPostMediaDto,
  CAMPOS_DE_MEDIA,
  ListEmployeePostsDto,
  OPCIONES_DE_SUBIDA_DE_MEDIA,
  PostCaptionDto,
  ReorderPostMediaDto,
} from './dto/employee-posts.dto';
import {
  PaginaDePosts,
  PostDeLaModelo,
  PostsService,
  ResultadoDeBorrar,
} from './posts.service';

type ArchivosDeMedia = {
  file?: UploadedFilePayload[];
  poster?: UploadedFilePayload[];
};

/**
 * Posts del feed vistos por la propia modelo, desde su portal.
 *
 * Como el resto del portal, entra con `PortalAuthGuard` (token por query,
 * Bearer o cookie; CSRF solo cuando hay cookie) y no con `RolesGuard`: el
 * portal no lleva la sesion del panel. El guard no mira el rol, asi que la
 * barrera es `EmployeesService.findByUserId`, que responde 404 a cualquier
 * cuenta que no sea una empleada (un cliente con token incluido). Cada ruta
 * la resuelve y opera solo sobre los posts de esa empleada.
 */
@Controller('employee-portal/posts')
@ApiControllerDocs('employee-portal')
@UseGuards(PortalAuthGuard)
export class EmployeePostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Get()
  async listar(
    @PortalUser() userId: string,
    @Query() query: ListEmployeePostsDto,
  ): Promise<PaginaDePosts> {
    const employeeId = await this.modelo(userId);
    return this.postsService.listarDeLaModelo(employeeId, query);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @HttpCode(201)
  async crear(
    @PortalUser() userId: string,
    @Body() dto: PostCaptionDto,
  ): Promise<PostDeLaModelo> {
    const employeeId = await this.modelo(userId);
    return this.postsService.crearBorrador({
      employeeId,
      authorUserId: userId,
      authorRole: 'empleada',
      caption: dto.caption,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch(':id')
  async editar(
    @PortalUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostCaptionDto,
  ): Promise<PostDeLaModelo> {
    const employeeId = await this.modelo(userId);
    return this.postsService.editarCaption(id, employeeId, dto.caption);
  }

  /**
   * Una foto o un video por peticion (multipart: `file`; `poster` si es
   * video; `width`, `height` y `durationMs` opcionales). El tipo lo deciden
   * los bytes en el servicio, no el mimetype declarado.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/media')
  @HttpCode(201)
  @UseInterceptors(
    FileFieldsInterceptor(CAMPOS_DE_MEDIA, OPCIONES_DE_SUBIDA_DE_MEDIA),
  )
  async agregarMedia(
    @PortalUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() archivos: ArchivosDeMedia | undefined,
    @Body() dto: AddPostMediaDto,
  ): Promise<PostDeLaModelo> {
    const archivo = archivos?.file?.[0];
    if (!archivo) {
      throw new BadRequestException('Falta el archivo en el campo "file"');
    }
    const employeeId = await this.modelo(userId);
    return this.postsService.agregarMedia(id, employeeId, {
      buffer: archivo.buffer,
      posterBuffer: archivos?.poster?.[0]?.buffer,
      width: dto.width,
      height: dto.height,
      durationMs: dto.durationMs,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Delete(':id/media/:mediaId')
  async quitarMedia(
    @PortalUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<PostDeLaModelo> {
    const employeeId = await this.modelo(userId);
    return this.postsService.quitarMedia(id, employeeId, mediaId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Put(':id/media/order')
  async reordenarMedia(
    @PortalUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPostMediaDto,
  ): Promise<PostDeLaModelo> {
    const employeeId = await this.modelo(userId);
    return this.postsService.reordenarMedia(id, employeeId, dto.ids);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/submit')
  @HttpCode(200)
  async enviar(
    @PortalUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDeLaModelo> {
    const employeeId = await this.modelo(userId);
    return this.postsService.enviar(id, employeeId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Delete(':id')
  async borrar(
    @PortalUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResultadoDeBorrar> {
    const employeeId = await this.modelo(userId);
    return this.postsService.borrar(id, employeeId);
  }

  /** Empleada de la cuenta del portal; 404 si la cuenta no es de una empleada. */
  private async modelo(userId: string): Promise<string> {
    const empleada = await this.employeesService.findByUserId(userId);
    return empleada.id;
  }
}
