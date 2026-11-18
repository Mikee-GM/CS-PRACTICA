import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { Column, Entity, Index, OneToMany, OneToOne } from 'typeorm';
import { AlertasClientes } from '../../client-alerts/entities/client-alert.entity';
import { Choferes } from '../../drivers/entities/driver.entity';
import { Empleadas } from '../../employees/entities/employee.entity';
import { ExtrasServicio } from '../../service-extras/entities/service-extra.entity';
import { Servicios } from '../../services/entities/service.entity';

@Index('usuarios_email_key', ['email'], { unique: true })
@Index('usuarios_pkey', ['id'], { unique: true })
@Index('idx_usuarios_rol', ['rol'], {})
@Entity('usuarios', { schema: 'public' })
export class Usuarios {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  @ApiProperty({
    description: 'Id',
    example: '00000000-0000-4000-8000-000000000000',
  })
  id: string;

  @Column('character varying', { name: 'email', unique: true, length: 255 })
  @ApiProperty({ description: 'Email', example: 'usuario@example.com' })
  email: string;

  /**
   * `select: false` para que ninguna consulta lo traiga por accidente: las
   * entidades se serializan tal cual en varias respuestas y basta una relacion
   * anidada (`empleada.usuario`) para filtrar el hash. Se lee explicitamente
   * con `addSelect` solo en AuthService.login.
   */
  @Column('text', { name: 'password_hash', select: false })
  @Exclude()
  @ApiHideProperty()
  passwordHash: string;

  @Column('enum', {
    name: 'rol',
    enum: ['jefe', 'empleada', 'chofer', 'admin', 'cliente'],
  })
  @ApiProperty({
    description: 'Rol',
    enum: ['jefe', 'empleada', 'chofer', 'admin', 'cliente'],
    example: 'jefe',
  })
  rol: 'jefe' | 'empleada' | 'chofer' | 'admin' | 'cliente';

  @Column('character varying', { name: 'nombre', nullable: true, length: 255 })
  @ApiPropertyOptional({ description: 'Nombre', example: 'Juan' })
  nombre: string | null;

  @Column('character varying', {
    name: 'apellido',
    nullable: true,
    length: 255,
  })
  @ApiPropertyOptional({ description: 'Apellido', example: 'Pérez' })
  apellido: string | null;

  @Column('boolean', { name: 'activo', default: () => 'true' })
  @ApiProperty({ description: 'Activo', example: true })
  activo: boolean;

  /**
   * La contraseña actual la puso otra persona (alta o restablecimiento) y hay
   * que cambiarla. Es una marca de UX para el frontend, no una barrera: el
   * backend no bloquea la API mientras este en true. La proteccion real es que
   * la temporal solo se entrega una vez y las sesiones previas se revocan.
   */
  @Column('boolean', { name: 'debe_cambiar_password', default: () => 'false' })
  @ApiProperty({
    description: 'Debe cambiar la contraseña en el proximo acceso',
    example: false,
  })
  debeCambiarPassword: boolean;

  @Column('boolean', { name: 'disponible', default: () => 'true' })
  @ApiProperty({
    description: 'Disponible (para jefes/choferes)',
    example: true,
  })
  disponible: boolean;

  /**
   * Si la persona esta dentro de su jornada de trabajo.
   *
   * No es lo mismo que `disponible`, que dice si puede tomar algo *ahora*: una
   * modelo en servicio y una que ya termino su dia estan las dos no
   * disponibles, pero solo la segunda dejo de trabajar. Mezclarlas impedia
   * distinguir "esta ocupada" de "ya no cuenten conmigo hoy".
   */
  @Column('boolean', { name: 'en_jornada', default: () => 'true' })
  @ApiProperty({
    description: 'La persona sigue dentro de su jornada de trabajo',
    example: true,
  })
  enJornada: boolean;

  @Column('timestamp with time zone', {
    name: 'jornada_actualizada_at',
    nullable: true,
  })
  @ApiPropertyOptional({
    description: 'Cuando cambio por ultima vez su estado de jornada',
    type: String,
    format: 'date-time',
  })
  jornadaActualizadaAt: Date | null;

  /**
   * Por que cerro su jornada, si lo dijo.
   *
   * Puede escribirlo ella al cerrar o contestarlo despues, cuando el jefe se lo
   * pregunta por el canal. Es opcional en los dos casos: el boton de cerrar no
   * puede depender de que rellene nada, porque quien lo pulsa normalmente ya
   * termino por hoy. Se limpia al volver a jornada, que es cuando deja de
   * describir nada.
   */
  @Column('text', { name: 'jornada_motivo', nullable: true })
  @ApiPropertyOptional({ description: 'Motivo del cierre de jornada' })
  jornadaMotivo: string | null;

  @Column('timestamp with time zone', {
    name: 'jornada_motivo_at',
    nullable: true,
  })
  @ApiPropertyOptional({
    description: 'Cuando dio el motivo del cierre',
    type: String,
    format: 'date-time',
  })
  jornadaMotivoAt: Date | null;

  @Column('character varying', { name: 'telefono', nullable: true, length: 50 })
  @ApiPropertyOptional({ description: 'Telefono', example: '+525512345678' })
  telefono: string | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  @ApiProperty({
    description: 'Created At',
    type: String,
    format: 'date-time',
    example: '2026-07-09T12:00:00.000Z',
  })
  createdAt: Date;

  @Column('timestamp with time zone', { name: 'last_login_at', nullable: true })
  @ApiPropertyOptional({
    description: 'Last Login At',
    type: String,
    format: 'date-time',
    example: '2026-07-09T12:00:00.000Z',
  })
  lastLoginAt: Date | null;

  @OneToMany(
    () => AlertasClientes,
    (alertasClientes) => alertasClientes.atendidaPor,
  )
  @ApiProperty({
    description: 'Alertas Clientes',
    type: () => [AlertasClientes],
    example: [],
  })
  alertasClientes: AlertasClientes[];

  @OneToOne(() => Choferes, (choferes) => choferes.usuario)
  @ApiProperty({ description: 'Choferes', type: () => Choferes })
  choferes: Choferes;

  @OneToOne(() => Empleadas, (empleadas) => empleadas.usuario)
  @ApiProperty({ description: 'Empleadas', type: () => Empleadas })
  empleadas: Empleadas;

  @OneToMany(
    () => ExtrasServicio,
    (extrasServicio) => extrasServicio.registradoPor,
  )
  @ApiProperty({
    description: 'Extras Servicios',
    type: () => [ExtrasServicio],
    example: [],
  })
  extrasServicios: ExtrasServicio[];

  @OneToMany(() => Servicios, (servicios) => servicios.jefe)
  @ApiProperty({
    description: 'Servicios',
    type: () => [Servicios],
    example: [],
  })
  servicios: Servicios[];
}
