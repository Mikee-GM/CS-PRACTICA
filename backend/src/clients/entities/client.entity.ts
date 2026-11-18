import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { Usuarios } from '../../users/entities/user.entity';
import { AlertasClientes } from '../../client-alerts/entities/client-alert.entity';
import { Servicios } from '../../services/entities/service.entity';
import { ClientMembership } from '../../loyalty/entities/client-membership.entity';
import { LoyaltyTransaction } from '../../loyalty/entities/loyalty-transaction.entity';

@Index('clientes_pkey', ['id'], { unique: true })
@Entity('clientes', { schema: 'public' })
export class Clientes {
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

  @Column('uuid', { name: 'usuario_id', nullable: true, unique: true })
  @ApiPropertyOptional({ description: 'Cuenta web del cliente' })
  usuarioId: string | null;

  @OneToOne(() => Usuarios, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuarios | null;

  /** Mientras sea nulo la cuenta funciona igual: la verificacion no bloquea. */
  @Column('timestamp with time zone', {
    name: 'correo_verificado_at',
    nullable: true,
  })
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  correoVerificadoAt: Date | null;

  @Column('timestamp with time zone', {
    name: 'mayor_de_edad_declarado_at',
    nullable: true,
  })
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  mayorDeEdadDeclaradoAt: Date | null;

  @Column('timestamp with time zone', {
    name: 'terminos_aceptados_at',
    nullable: true,
  })
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  terminosAceptadosAt: Date | null;

  @Column('integer', { name: 'ai_calls_today', default: 0 })
  @ApiProperty({ description: 'AI calls made today', example: 0 })
  aiCallsToday: number;

  @Column('timestamp with time zone', {
    name: 'last_ai_call_at',
    nullable: true,
  })
  @ApiPropertyOptional({
    description: 'Last time AI was called',
    type: String,
    format: 'date-time',
  })
  lastAiCallAt: Date | null;

  @Column('character varying', {
    name: 'nombre',
    nullable: true,
    length: 255,
  })
  @ApiPropertyOptional({ description: 'Nombre', example: 'Ejemplo' })
  nombre: string | null;

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

  @Column('timestamp with time zone', {
    name: 'primer_contacto_at',
    default: () => 'now()',
  })
  @ApiProperty({
    description: 'Primer Contacto At',
    type: String,
    format: 'date-time',
    example: '2026-07-09T12:00:00.000Z',
  })
  primerContactoAt: Date;

  @OneToMany(
    () => AlertasClientes,
    (alertasClientes) => alertasClientes.cliente,
  )
  @ApiProperty({
    description: 'Alertas Clientes',
    type: () => [AlertasClientes],
    example: [],
  })
  alertasClientes: AlertasClientes[];

  @OneToMany(() => Servicios, (servicios) => servicios.cliente)
  @ApiProperty({
    description: 'Servicios',
    type: () => [Servicios],
    example: [],
  })
  servicios: Servicios[];

  @OneToMany(
    () => LoyaltyTransaction,
    (loyaltyTransaction) => loyaltyTransaction.cliente,
  )
  @ApiProperty({
    description: 'Loyalty Transactions',
    type: () => [LoyaltyTransaction],
    example: [],
  })
  loyaltyTransactions: LoyaltyTransaction[];

  @OneToOne(() => ClientMembership, (membership) => membership.cliente)
  @ApiProperty({ description: 'Membership', type: () => ClientMembership })
  membership: ClientMembership;
}
