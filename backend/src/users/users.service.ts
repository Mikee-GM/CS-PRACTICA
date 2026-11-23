import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuarios } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
  ) {}

  /**
   * Solo un admin puede crear otro admin. Sin esta comprobacion cualquier jefe
   * podria escalar privilegios creandose una cuenta con rol 'admin'.
   */
  async create(createUserDto: CreateUserDto, actor?: Usuarios) {
    if (createUserDto.rol === 'admin' && actor?.rol !== 'admin') {
      throw new ForbiddenException(
        'Solo un administrador puede crear cuentas con rol admin',
      );
    }

    const { password, ...rest } = createUserDto;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    // La contraseña la tecleo quien da el alta: es temporal y su dueño debe
    // cambiarla al entrar (Fase 5, B-acceso).
    const user = this.usuariosRepository.create({
      ...rest,
      passwordHash,
      debeCambiarPassword: true,
    });
    const saved = await this.usuariosRepository.save(user);
    return this.stripSecrets(saved);
  }

  /**
   * El hash nunca sale del backend. La columna ya es `select: false`, pero en
   * la ruta de creacion la entidad viene de memoria, no de la base, asi que hay
   * que quitarlo a mano.
   */
  private stripSecrets(user: Usuarios): Omit<Usuarios, 'passwordHash'> {
    const { passwordHash: _omitted, ...safe } = user;
    return safe;
  }

  /** Acotado: la tabla de usuarios no tiene por que caber entera en memoria. */
  findAll(rol?: Usuarios['rol'], limit = 200, offset = 0) {
    return this.usuariosRepository.find({
      where: rol ? { rol } : undefined,
      order: { createdAt: 'DESC' },
      take: Math.min(500, Math.max(1, Math.trunc(limit))),
      skip: Math.max(0, Math.trunc(offset)),
    });
  }

  findOne(id: string) {
    return this.usuariosRepository.findOne({ where: { id } });
  }

  /**
   * El mismo cerrojo que en la creacion, que aqui faltaba.
   *
   * `create` comprueba que solo un admin pueda crear otro admin, pero esta ruta
   * esta abierta a `admin` y `jefe` y volcaba el DTO entero en el UPDATE.
   * `UpdateUserDto` es un `PartialType` del de creacion, asi que incluye `rol`:
   * cualquier jefe podia ascenderse a admin con un PATCH sobre su propio
   * usuario, que es exactamente la escalada que el cerrojo de arriba existe
   * para impedir.
   *
   * Se comprueba tanto ascender a alguien a admin como degradar a un admin: las
   * dos son decisiones que solo le tocan a un admin.
   */
  async update(id: string, updateUserDto: UpdateUserDto, actor?: Usuarios) {
    const { password, ...toUpdate } = updateUserDto as any;
    const updateData: any = { ...toUpdate };

    if (actor?.rol !== 'admin') {
      // Un jefe no toca las cuentas de un admin ni de otro jefe (email, estado,
      // nombre): con `activo: false` dejaria a un admin sin acceso. Su propia
      // cuenta si, igual que el resto del personal que ya podia editar.
      const objetivo = await this.usuariosRepository.findOne({ where: { id } });
      if (
        objetivo &&
        objetivo.id !== actor?.id &&
        (objetivo.rol === 'admin' || objetivo.rol === 'jefe')
      ) {
        throw new ForbiddenException(
          'Un jefe no puede modificar la cuenta de un administrador ni de otro jefe',
        );
      }
    }

    if (updateData.rol !== undefined && actor?.rol !== 'admin') {
      const actual = await this.usuariosRepository.findOne({ where: { id } });
      if (updateData.rol === 'admin' || actual?.rol === 'admin') {
        throw new ForbiddenException(
          'Solo un administrador puede cambiar el rol de una cuenta admin',
        );
      }
    }

    if (password) {
      // Esta ruta la alcanza un jefe, y con `password` en el cuerpo podia cambiar
      // la clave de cualquier cuenta que no fuera admin sin pasar por el alcance
      // del restablecimiento, sin marcar el cambio forzado y sin cerrar sesiones.
      // Para el personal a su cargo existe `POST /users/:id/reset-password`; para
      // la cuenta propia, `PATCH /users/me/password`.
      if (actor?.rol !== 'admin') {
        throw new ForbiddenException(
          'Solo un administrador puede cambiar la contraseña de otra cuenta',
        );
      }
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(password, salt);
      // La fija un tercero: quien entra despues debe elegir la suya.
      if (actor.id !== id) updateData.debeCambiarPassword = true;
    }

    // TypeORM rechaza un UPDATE sin valores (`UpdateValuesMissingError`): un
    // PATCH con cuerpo vacio terminaba en 500 en vez de devolver el usuario.
    if (Object.keys(updateData).length > 0) {
      await this.usuariosRepository.update(id, updateData);
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const resultado = await this.usuariosRepository.delete(id);
    // Antes respondia `deleted: true` aunque el usuario no existiera.
    if (!resultado.affected) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return { deleted: true };
  }
}
