import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { WorkShiftStatusDto } from './dto/work-shift-status.dto';
import { WorkShiftStatusService } from './work-shift-status.service';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
import {
  CuentaDelPersonalService,
  PerfilDelPersonal,
} from './cuenta-del-personal.service';
import { Usuarios } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { SesionActual } from '../auth/decorators/sesion-actual.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import {
  ApiActionDocs,
  ApiControllerDocs,
  ApiCreateDocs,
  ApiFindAllDocs,
  ApiFindOneDocs,
  ApiRemoveDocs,
  ApiUpdateDocs,
} from '../common/swagger/api-docs.decorators';

@Controller('users')
@ApiControllerDocs('users', true)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly workShiftStatus: WorkShiftStatusService,
    private readonly cuentaDelPersonal: CuentaDelPersonalService,
  ) {}

  @Post()
  @ApiCreateDocs({
    tag: 'users',
    entity: Usuarios,
    createDto: CreateUserDto,
    protected: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  create(@Body() createUserDto: CreateUserDto, @GetUser() actor: Usuarios) {
    return this.usersService.create(createUserDto, actor);
  }

  @Get()
  @ApiFindAllDocs({ tag: 'users', entity: Usuarios, protected: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  findAll(@Query('rol') rol?: Usuarios['rol']) {
    return this.usersService.findAll(rol);
  }

  /**
   * Estado de jornada de quien pregunta. Sin `:id`: cada quien consulta y
   * cambia el suyo, y no hace falta que el panel sepa su propio id.
   */
  @Get('me/jornada')
  @UseGuards(JwtAuthGuard)
  getMyWorkShift(@Req() req: any) {
    return this.workShiftStatus.getStatus(req.user.id);
  }

  /**
   * Cierra o reabre la jornada. Cualquier rol puede cambiar el suyo; lo que
   * cambia segun el rol es a quien se avisa.
   */
  @Patch('me/jornada')
  @UseGuards(JwtAuthGuard)
  setMyWorkShift(@Body() dto: WorkShiftStatusDto, @Req() req: any) {
    return this.workShiftStatus.setStatus(req.user, dto.enJornada, dto.motivo);
  }

  /*
   * Rutas `me/...` de la cuenta propia (Fase 5, B-acceso). Van antes de
   * `@Patch(':id')`: Express prueba las rutas en el orden en que se declaran y
   * `PATCH /users/me` caeria en `:id` con id "me".
   *
   * Solo personal: el cliente tiene `client-accounts/me/...`.
   */

  /**
   * Cambio de contraseña propio. Quita la marca de cambio obligatorio y cierra
   * las demas sesiones. `@SesionActual()` depende de que JwtAuthGuard ya haya
   * verificado el token.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Patch('me/password')
  // Sin `ApiActionDocs`: ese decorador documenta un `:id` que aqui no hay.
  @ApiOperation({ summary: 'Cambiar la contraseña propia' })
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe', 'empleada', 'chofer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarMiPassword(
    @GetUser() actor: Usuarios,
    @SesionActual() sesion: SesionActual,
    @Body() dto: ChangeOwnPasswordDto,
  ): Promise<void> {
    await this.cuentaDelPersonal.cambiarPassword(actor.id, sesion, dto);
  }

  /** Nombre, apellido y telefono propios; nunca email, rol ni `activo`. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch('me')
  @ApiOperation({ summary: 'Actualizar el perfil propio' })
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe', 'empleada', 'chofer')
  actualizarMiPerfil(
    @GetUser() actor: Usuarios,
    @Body() dto: UpdateOwnProfileDto,
  ): Promise<PerfilDelPersonal> {
    return this.cuentaDelPersonal.actualizarPerfil(actor.id, dto);
  }

  /** Personal fuera de jornada, para el panel de admin. */
  @Get('off-duty')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  listOffDuty() {
    return this.workShiftStatus.listOffDuty();
  }

  @Get(':id')
  @ApiFindOneDocs({ tag: 'users', entity: Usuarios, protected: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiUpdateDocs({
    tag: 'users',
    entity: Usuarios,
    updateDto: UpdateUserDto,
    protected: true,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'jefe')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() actor: Usuarios,
  ) {
    return this.usersService.update(id, updateUserDto, actor);
  }

  @Delete(':id')
  @ApiRemoveDocs({ tag: 'users', protected: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  /**
   * Restablece la contraseña con una temporal que se devuelve UNA sola vez en
   * `{ passwordTemporal }`; no hay forma de volver a leerla. El alcance (admin
   * a todo el personal, jefe solo a las modelos de su equipo) lo decide el
   * servicio.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/reset-password')
  @ApiActionDocs(
    'Restablecer la contraseña con una temporal',
    true,
    'ID del usuario',
  )
  @UseGuards(JwtAuthGuard, RolesGuard, CsrfGuard)
  @Roles('admin', 'jefe')
  @HttpCode(HttpStatus.OK)
  restablecerPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() actor: Usuarios,
  ): Promise<{ passwordTemporal: string }> {
    return this.cuentaDelPersonal.restablecerPassword(actor, id);
  }
}
