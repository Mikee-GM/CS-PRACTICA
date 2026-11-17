import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, In, Repository } from 'typeorm';
import type { SesionActual } from '../auth/decorators/sesion-actual.decorator';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
import { Usuarios } from './entities/user.entity';
import { generarPasswordTemporal } from './password-temporal';

/** Roles que usan estas rutas. El cliente tiene las suyas en `client-accounts`. */
export const ROLES_DEL_PERSONAL = [
  'admin',
  'jefe',
  'empleada',
  'chofer',
] as const;

export type PerfilDelPersonal = Pick<
  Usuarios,
  | 'id'
  | 'email'
  | 'rol'
  | 'nombre'
  | 'apellido'
  | 'telefono'
  | 'debeCambiarPassword'
>;

const NO_ENCONTRADO = 'Usuario no encontrado';

/**
 * Acceso del personal sin Telegram ni correo (Fase 5, B-acceso): cambio de
 * contraseña y perfil propios, y restablecimiento por el admin o el jefe con
 * una contraseña temporal.
 *
 * Vive aparte de `UsersService` porque necesita las sesiones y las modelos, y
 * `UsersService` es el CRUD del panel con su propio cerrojo de escalada.
 */
@Injectable()
export class CuentaDelPersonalService {
  private readonly logger = new Logger(CuentaDelPersonalService.name);

  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Cambia la contraseña propia, quita la marca de cambio obligatorio y cierra
   * las demas sesiones.
   *
   * Quien cambia la contraseña suele hacerlo porque sospecha que otro la
   * conoce, y en el cambio forzado es seguro que otro la conoce: dejar vivas
   * las otras sesiones haria inutil el cambio. Se conserva la familia de la
   * sesion actual, no solo su `sid`, por la misma razon que en
   * `ClientAccountsService.cambiarPassword`: una renovacion que se cruce con
   * esta peticion crea una sesion nueva de esa familia.
   */
  async cambiarPassword(
    usuarioId: string,
    sesion: SesionActual,
    dto: ChangeOwnPasswordDto,
  ): Promise<void> {
    const usuario = await this.usuariosRepository
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :usuarioId', { usuarioId })
      .andWhere('u.rol IN (:...roles)', { roles: [...ROLES_DEL_PERSONAL] })
      .getOne();
    // Sin relleno de bcrypt: quien llega aqui ya esta autenticado como este
    // usuario, no hay correos que enumerar.
    const coincide = usuario
      ? await bcrypt.compare(dto.actual, usuario.passwordHash)
      : false;
    if (!usuario || !coincide) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    if (dto.nueva === dto.actual) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta de la actual',
      );
    }

    const passwordHash = await bcrypt.hash(dto.nueva, 10);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Usuarios,
        { id: usuarioId },
        { passwordHash, debeCambiarPassword: false },
      );
      const revocar = manager
        .createQueryBuilder()
        .update(AuthSession)
        .set({ revokedAt: () => 'now()' })
        .where('user_id = :usuarioId AND revoked_at IS NULL', { usuarioId })
        .andWhere('id <> :sid', { sid: sesion.sid });
      if (sesion.familyId) {
        revocar.andWhere('family_id <> :familyId', {
          familyId: sesion.familyId,
        });
      }
      await revocar.execute();
    });
  }

  /**
   * Nombre, apellido y telefono propios. El email, el rol y `activo` no estan
   * en el DTO: los decide el admin desde `PATCH /users/:id`.
   */
  async actualizarPerfil(
    usuarioId: string,
    dto: UpdateOwnProfileDto,
  ): Promise<PerfilDelPersonal> {
    const cambios: Partial<Pick<Usuarios, 'nombre' | 'apellido' | 'telefono'>> =
      {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.apellido !== undefined) cambios.apellido = dto.apellido;
    // Un telefono vacio es "ya no tengo telefono", no un telefono "".
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono || null;

    if (Object.keys(cambios).length > 0) {
      await this.usuariosRepository.update(
        { id: usuarioId, rol: In([...ROLES_DEL_PERSONAL]) },
        cambios,
      );
    }

    const perfil = await this.usuariosRepository.findOne({
      where: { id: usuarioId, rol: In([...ROLES_DEL_PERSONAL]) },
      select: {
        id: true,
        email: true,
        rol: true,
        nombre: true,
        apellido: true,
        telefono: true,
        debeCambiarPassword: true,
      },
    });
    if (!perfil) throw new NotFoundException(NO_ENCONTRADO);
    return {
      id: perfil.id,
      email: perfil.email,
      rol: perfil.rol,
      nombre: perfil.nombre ?? null,
      apellido: perfil.apellido ?? null,
      telefono: perfil.telefono ?? null,
      debeCambiarPassword: perfil.debeCambiarPassword ?? false,
    };
  }

  /**
   * Restablece la contraseña de alguien del personal con una temporal.
   *
   * La temporal se devuelve UNA sola vez, en esta respuesta: en la base solo
   * queda su hash y no existe ruta que la vuelva a leer. Tampoco se escribe en
   * logs ni en mensajes de error; el registro de auditoria dice quien
   * restablecio a quien, nunca el valor. Si se pierde, se restablece otra vez.
   *
   * Se revocan TODAS las sesiones del usuario: si se restablece es porque
   * perdio el acceso o porque alguien mas lo tiene, y en los dos casos no debe
   * quedar ninguna sesion vieja viva.
   *
   * La marca `debe_cambiar_password` hace que el frontend pida cambiarla al
   * entrar; el backend no bloquea nada mientras siga puesta. Es UX, no
   * seguridad.
   */
  async restablecerPassword(
    actor: Pick<Usuarios, 'id' | 'rol'>,
    usuarioId: string,
  ): Promise<{ passwordTemporal: string }> {
    if (usuarioId === actor.id) {
      throw new BadRequestException(
        'Para tu propia cuenta usa el cambio de contraseña',
      );
    }

    const objetivo = await this.usuariosRepository.findOne({
      where: { id: usuarioId },
      select: { id: true, rol: true, activo: true },
    });
    // Los clientes tienen su propio flujo: por aqui ni siquiera existen.
    if (!objetivo || objetivo.rol === 'cliente') {
      throw new NotFoundException(NO_ENCONTRADO);
    }
    await this.comprobarAlcance(actor, objetivo);

    // Despues del alcance, para no contarle a un jefe nada de una cuenta que
    // no es suya. Restablecer una cuenta desactivada no le devolveria el
    // acceso (el login la rechaza) y daria a entender que si: se pide
    // reactivarla primero.
    if (!objetivo.activo) {
      throw new ConflictException(
        'La cuenta está desactivada; reactívala antes de restablecer la contraseña',
      );
    }

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await bcrypt.hash(passwordTemporal, 10);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Usuarios,
        { id: objetivo.id },
        { passwordHash, debeCambiarPassword: true },
      );
      await manager
        .createQueryBuilder()
        .update(AuthSession)
        .set({ revokedAt: () => 'now()' })
        .where('user_id = :usuarioId AND revoked_at IS NULL', {
          usuarioId: objetivo.id,
        })
        .execute();
    });

    this.logger.log(
      `Contraseña restablecida: usuario ${objetivo.id} (${objetivo.rol}) por ${actor.rol} ${actor.id}`,
    );
    return { passwordTemporal };
  }

  /**
   * Quien puede restablecer a quien.
   *
   * - El admin, a cualquiera del personal (otros admins incluidos).
   * - Un jefe nunca a un admin ni a otro jefe: es el mismo cerrojo de escalada
   *   que `UsersService.create/update`, y por eso responde 403 como alli.
   * - Un jefe, a las modelos de su equipo: las que lo tienen como jefe
   *   principal o secundario. No se usa el relevo de `jefeAlcanzaModelo` (que
   *   deja a cualquier jefe atender a una modelo cuyos jefes no estan): sirve
   *   para que un chat no se quede sin nadie, no para entregar la llave de una
   *   cuenta ajena.
   * - Los choferes no tienen relacion con ningun jefe en el modelo de datos,
   *   asi que solo los restablece el admin.
   *
   * Lo que no le toca a un jefe responde 404, igual que un usuario que no
   * existe.
   */
  private async comprobarAlcance(
    actor: Pick<Usuarios, 'id' | 'rol'>,
    objetivo: Pick<Usuarios, 'id' | 'rol'>,
  ): Promise<void> {
    if (actor.rol === 'admin') return;
    if (actor.rol !== 'jefe') throw new NotFoundException(NO_ENCONTRADO);

    if (objetivo.rol === 'admin' || objetivo.rol === 'jefe') {
      throw new ForbiddenException(
        'Un jefe no puede restablecer la contraseña de otro jefe ni de un administrador',
      );
    }
    if (objetivo.rol !== 'empleada') {
      throw new NotFoundException(NO_ENCONTRADO);
    }
    const deSuEquipo = await this.empleadasRepository.count({
      where: [
        { usuarioId: objetivo.id, jefeId: actor.id },
        { usuarioId: objetivo.id, jefeSecundarioId: actor.id },
      ],
    });
    if (deSuEquipo === 0) throw new NotFoundException(NO_ENCONTRADO);
  }
}
