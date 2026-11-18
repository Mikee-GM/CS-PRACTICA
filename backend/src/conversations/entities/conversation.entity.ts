import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Clientes } from '../../clients/entities/client.entity';
import { Empleadas } from '../../employees/entities/employee.entity';
import { Servicios } from '../../services/entities/service.entity';
import { CustomerBookingSession } from '../../booking/entities/customer-booking-session.entity';
import { Usuarios } from '../../users/entities/user.entity';

export const CONVERSATION_STATUSES = [
  'activa',
  'en_revision',
  'con_servicio',
  'cerrada',
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

// Mismo vocabulario que `customer_booking_sessions.mode`: el borrador de
// reserva y la conversacion web describen el mismo traspaso a un humano.
export const CONVERSATION_MODES = ['AI_ACTIVE', 'HUMAN_ACTIVE'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/**
 * Chat web entre un cliente y el asistente de una modelo.
 *
 * Solo puede haber
 * una conversacion abierta por pareja cliente-modelo (indice unico parcial):
 * al cerrarse, la siguiente reserva abre otra y el historial queda intacto.
 * `state` guarda el estado de la reserva que lleva el asistente y
 * `state_version` permite escribirlo con bloqueo optimista cuando la IA y un
 * jefe actuan a la vez.
 */
@Entity('conversations', { schema: 'public' })
@Index('uq_conversations_client_employee_open', ['clientId', 'employeeId'], {
  unique: true,
  where: `"status" <> 'cerrada'`,
})
@Index('uq_conversations_booking_session', ['bookingSessionId'], {
  unique: true,
})
@Index('idx_conversations_client_last_message', ['clientId', 'lastMessageAt'])
@Index('idx_conversations_employee_last_message', [
  'employeeId',
  'lastMessageAt',
])
@Index('idx_conversations_human_owner', ['humanOwnerId'])
@Index('idx_conversations_service', ['serviceId'])
export class Conversation {
  @PrimaryColumn('uuid', {
    name: 'id',
    default: () => 'gen_random_uuid()',
    primaryKeyConstraintName: 'pk_conversations',
  })
  id: string;

  @Column('uuid', { name: 'client_id' })
  clientId: string;

  @ManyToOne(() => Clientes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'client_id',
    foreignKeyConstraintName: 'fk_conversations_client',
  })
  client: Clientes;

  // La modelo elegida en el catalogo. RESTRICT, como en `servicios`: borrar a
  // una empleada no debe llevarse el historial de chats con clientes.
  @Column('uuid', { name: 'employee_id' })
  employeeId: string;

  @ManyToOne(() => Empleadas, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'employee_id',
    foreignKeyConstraintName: 'fk_conversations_employee',
  })
  employee: Empleadas;

  @Column('uuid', { name: 'booking_session_id', nullable: true })
  bookingSessionId: string | null;

  @ManyToOne(() => CustomerBookingSession, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'booking_session_id',
    foreignKeyConstraintName: 'fk_conversations_booking_session',
  })
  bookingSession: CustomerBookingSession | null;

  @Column('uuid', { name: 'service_id', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Servicios, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'service_id',
    foreignKeyConstraintName: 'fk_conversations_service',
  })
  service: Servicios | null;

  @Column({
    type: 'enum',
    enum: CONVERSATION_STATUSES,
    enumName: 'conversations_status_enum',
    default: 'activa',
  })
  status: ConversationStatus;

  @Column({
    type: 'enum',
    enum: CONVERSATION_MODES,
    enumName: 'conversations_mode_enum',
    default: 'AI_ACTIVE',
  })
  mode: ConversationMode;

  // Jefe que tomo el control. Si su cuenta desaparece la conversacion sigue
  // viva y otro jefe puede retomarla.
  @Column('uuid', { name: 'human_owner_id', nullable: true })
  humanOwnerId: string | null;

  @ManyToOne(() => Usuarios, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'human_owner_id',
    foreignKeyConstraintName: 'fk_conversations_human_owner',
  })
  humanOwner: Usuarios | null;

  @Column('timestamp with time zone', {
    name: 'human_taken_at',
    nullable: true,
  })
  humanTakenAt: Date | null;

  @Column('jsonb', { default: () => "'{}'::jsonb" })
  state: Record<string, unknown>;

  @Column('integer', { name: 'state_version', default: 0 })
  stateVersion: number;

  @Column('timestamp with time zone', {
    name: 'last_message_at',
    nullable: true,
  })
  lastMessageAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
