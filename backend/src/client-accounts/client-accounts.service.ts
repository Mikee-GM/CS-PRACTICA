import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import type { SesionActual } from '../auth/decorators/sesion-actual.decorator';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { describeError } from '../common/errors/error-message';
import { Mailer } from '../common/mail/mailer';
import { Clientes } from '../clients/entities/client.entity';
import { Usuarios } from '../users/entities/user.entity';
import { ChangeClientPasswordDto } from './dto/change-client-password.dto';
import { RegisterClientDto } from './dto/register-client.dto';
import { VerificacionCorreo } from './entities/email-verification.entity';
import { NivelDelClienteService } from './nivel-del-cliente.service';
import {
  calificacionDelCliente,
  serviciosFinalizados,
  tieneSancionVigente,
} from './perfil-del-cliente';

/** Vigencia del enlace de verificacion. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimo entre un envio y el siguiente, para que no sirva de metralleta. */
const RESEND_COOLDOWN_MS = 60 * 1000;

export type CuentaCliente = {
  id: string;
  email: string;
  nombre: string | null;
  correoVerificado: boolean;
};

/**
 * Lo que el cliente ve de si mismo. Lista cerrada a proposito: nada de ids
 * internos, de quien califico ni del comentario de la calificacion, que es
 * interno del equipo; y de una sancion solo que existe, nunca su motivo.
 */
export type PerfilDelCliente = {
  nombre: string | null;
  email: string;
  correoVerificado: boolean;
  miembroDesde: string;
  servicios: number;
  calificacion: { promedio: number | null; cantidad: number };
  nivel: { codigo: string; nombre: string };
  estado: 'activa' | 'restringida';
};

/**
 * Hash bcrypt de una cadena cualquiera. Si la cuenta no aparece se compara
 * contra el igualmente, para que la respuesta tarde lo mismo que con una
 * contraseña incorrecta.
 */
const HASH_DE_RELLENO =
  '$2b$10$Snj1RqaARDJOI4JxP4lwpOx3du9nk9eCGVDCa2r/FIyHKycekbTE.';

@Injectable()
export class ClientAccountsService {
  private readonly logger = new Logger(ClientAccountsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(VerificacionCorreo)
    private readonly verificacionesRepository: Repository<VerificacionCorreo>,
    private readonly mailer: Mailer,
    private readonly configService: ConfigService,
    // Con valor por defecto porque la regla del nivel es una funcion pura sin
    // dependencias: quien construye el servicio a mano no tiene que pasarla.
    private readonly nivelDelCliente: NivelDelClienteService = new NivelDelClienteService(),
  ) {}

  /**
   * Crea la cuenta y su ficha de cliente en una sola transaccion, y deja
   * enviado el enlace de verificacion. La verificacion no bloquea nada: la
   * cuenta funciona desde el primer momento.
   *
   * Un correo repetido se responde con 409 y no con un registro silencioso:
   * quien se registra necesita saber que ya tiene cuenta. Es una fuga de
   * existencia de cuentas asumida a cambio de una experiencia clara; el
   * endpoint va con un limite de ritmo estricto.
   */
  async register(dto: RegisterClientDto): Promise<Usuarios> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const ahora = new Date();

    let usuario: Usuarios;
    let token: string;
    try {
      ({ usuario, token } = await this.dataSource.transaction(
        async (manager) => {
          const existente = await manager
            .createQueryBuilder(Usuarios, 'u')
            .where('LOWER(u.email) = :email', { email: dto.email })
            .getExists();
          if (existente) throw new ConflictException(YA_REGISTRADO);

          const creado = await manager.save(
            manager.create(Usuarios, {
              email: dto.email,
              passwordHash,
              rol: 'cliente',
              nombre: dto.nombre?.trim() || null,
              activo: true,
            }),
          );
          await manager.save(
            manager.create(Clientes, {
              usuarioId: creado.id,
              nombre: creado.nombre,
              mayorDeEdadDeclaradoAt: ahora,
              terminosAceptadosAt: ahora,
              correoVerificadoAt: null,
            }),
          );
          const nuevoToken = await this.crearToken(manager, creado.id);
          return { usuario: creado, token: nuevoToken };
        },
      ));
    } catch (error) {
      // Dos registros simultaneos con el mismo correo: gana uno, el otro cae
      // contra el indice unico en vez de contra la comprobacion de arriba.
      if (esViolacionDeUnicidad(error))
        throw new ConflictException(YA_REGISTRADO);
      throw error;
    }

    await this.enviarVerificacion(usuario, token);
    return usuario;
  }

  /** Canjea el token del correo. Es POST: un GET lo quemaria una previsualizacion. */
  async verify(token: string): Promise<void> {
    const ahora = new Date();
    const resultado = await this.dataSource.transaction(async (manager) => {
      // Un solo UPDATE condicionado decide la carrera entre dos canjes.
      const filas = await manager.query<{ usuario_id: string }[]>(
        `UPDATE "verificaciones_correo"
            SET "usado_at" = $2
          WHERE "token_hash" = $1
            AND "usado_at" IS NULL
            AND "expira_at" > $2
        RETURNING "usuario_id"`,
        [this.hashToken(token), ahora],
      );
      // Con RETURNING, Postgres devuelve [filas, cuenta] en el driver de pg.
      const usuarioId = extraerUsuarioId(filas);
      if (!usuarioId) return null;
      await manager.update(
        Clientes,
        { usuarioId },
        { correoVerificadoAt: ahora },
      );
      return usuarioId;
    });
    if (!resultado) {
      throw new BadRequestException('El enlace no es válido o ya venció');
    }
  }

  /** Reenvia el enlace; invalida los anteriores para que solo valga el ultimo. */
  async resend(usuarioId: string): Promise<void> {
    const cliente = await this.clientesRepository.findOne({
      where: { usuarioId },
      relations: { usuario: true },
    });
    if (!cliente?.usuario) throw new NotFoundException('Cuenta no encontrada');
    if (cliente.correoVerificadoAt) return;

    const ultimo = await this.verificacionesRepository.findOne({
      where: { usuarioId },
      order: { createdAt: 'DESC' },
    });
    if (
      ultimo &&
      Date.now() - ultimo.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(
        'Espera un minuto antes de pedir otro enlace',
      );
    }

    const token = await this.dataSource.transaction(async (manager) => {
      await manager.update(
        VerificacionCorreo,
        { usuarioId, usadoAt: IsNull() },
        { usadoAt: new Date() },
      );
      return this.crearToken(manager, usuarioId);
    });
    await this.enviarVerificacion(cliente.usuario, token);
  }

  async me(usuarioId: string): Promise<CuentaCliente> {
    const cliente = await this.clientesRepository.findOne({
      where: { usuarioId },
      relations: { usuario: true },
    });
    if (!cliente?.usuario) throw new NotFoundException('Cuenta no encontrada');
    return {
      id: cliente.id,
      email: cliente.usuario.email,
      nombre: cliente.usuario.nombre,
      correoVerificado: cliente.correoVerificadoAt !== null,
    };
  }

  async perfil(usuarioId: string): Promise<PerfilDelCliente> {
    const cliente = await this.clientesRepository.findOne({
      where: { usuarioId },
      relations: { usuario: true },
    });
    if (!cliente?.usuario) throw new NotFoundException('Cuenta no encontrada');

    const [calificacion, servicios, restringida] = await Promise.all([
      calificacionDelCliente(this.dataSource, cliente.id),
      serviciosFinalizados(this.dataSource, cliente.id),
      tieneSancionVigente(this.dataSource, cliente.id),
    ]);
    const nivel = this.nivelDelCliente.de({
      serviciosFinalizados: servicios,
      calificacion: calificacion.promedio,
      miembroDesde: cliente.createdAt,
    });

    // Se copian campo por campo para que un dato que se añada mañana a esas
    // estructuras no llegue al cliente sin que alguien lo decida.
    return {
      nombre: cliente.usuario.nombre,
      email: cliente.usuario.email,
      correoVerificado: cliente.correoVerificadoAt !== null,
      miembroDesde: cliente.createdAt.toISOString(),
      servicios,
      calificacion: {
        promedio: calificacion.promedio,
        cantidad: calificacion.cantidad,
      },
      nivel: { codigo: nivel.codigo, nombre: nivel.nombre },
      estado: restringida ? 'restringida' : 'activa',
    };
  }

  /** UPDATE de una sola columna: un `save` de la entidad pisaria lo demas. */
  async actualizarNombre(
    usuarioId: string,
    nombre: string,
  ): Promise<{ nombre: string }> {
    const resultado = await this.usuariosRepository.update(
      { id: usuarioId, rol: 'cliente' },
      { nombre },
    );
    if (!resultado.affected) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    return { nombre };
  }

  /**
   * Cambia la contraseña y cierra las demas sesiones de la cuenta.
   *
   * Quien cambia la contraseña suele hacerlo porque sospecha que otro la
   * conoce: dejar vivas sus sesiones haria inutil el cambio. Se conserva la
   * familia de la sesion actual (y no solo su `sid`) porque una renovacion
   * que se cruce con esta peticion crea una sesion nueva en la misma familia,
   * y revocarla dejaria fuera a quien acaba de cambiar su propia contraseña.
   */
  async cambiarPassword(
    usuarioId: string,
    sesion: SesionActual,
    dto: ChangeClientPasswordDto,
  ): Promise<void> {
    const usuario = await this.usuariosRepository
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :usuarioId', { usuarioId })
      .andWhere("u.rol = 'cliente'")
      .getOne();
    const coincide = await bcrypt.compare(
      dto.actual,
      usuario?.passwordHash ?? HASH_DE_RELLENO,
    );
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
      await manager.update(Usuarios, { id: usuarioId }, { passwordHash });
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

  private async crearToken(
    manager: EntityManager,
    usuarioId: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await manager.save(
      manager.create(VerificacionCorreo, {
        usuarioId,
        tokenHash: this.hashToken(token),
        expiraAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        usadoAt: null,
      }),
    );
    return token;
  }

  /** Un correo que falla nunca deshace el registro: se puede reenviar. */
  private async enviarVerificacion(
    usuario: Usuarios,
    token: string,
  ): Promise<void> {
    const base = this.configService
      .getOrThrow<string>('WEB_URL')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');
    try {
      await this.mailer.enviar({
        para: usuario.email,
        asunto: 'Confirma tu correo',
        texto: `Confirma tu correo para completar tu cuenta:\n${base}/verificar-correo?token=${token}\n\nEl enlace vale 24 horas.`,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo enviar la verificacion a ${usuario.email}: ${describeError(error)}`,
      );
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

const YA_REGISTRADO = 'Ya existe una cuenta con ese correo';

function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * `manager.query` con UPDATE ... RETURNING devuelve `[filas, cuenta]` en pg;
 * con otros drivers devolveria las filas directamente.
 */
function extraerUsuarioId(resultado: unknown): string | null {
  if (!Array.isArray(resultado)) return null;
  const filas: unknown = Array.isArray(resultado[0]) ? resultado[0] : resultado;
  if (!Array.isArray(filas) || filas.length === 0) return null;
  const primera = filas[0] as { usuario_id?: unknown };
  return typeof primera.usuario_id === 'string' ? primera.usuario_id : null;
}
