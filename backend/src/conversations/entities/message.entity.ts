import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { PaymentReceiptValidations } from '../../services/entities/payment-receipt-validation.entity';
import { Conversation } from './conversation.entity';

export const MESSAGE_SENDERS = ['cliente', 'ia', 'jefe', 'sistema'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

/**
 * Adjunto de un mensaje. Va en jsonb y no en columnas porque cada tipo usa
 * campos distintos y ninguno se consulta por separado; lo que si se consulta
 * (la validacion del comprobante) tiene su propia columna con llave foranea.
 */
export type MessageAttachment = {
  type: 'comprobante' | 'foto' | 'ubicacion';
  /** Clave o URL del archivo en R2; ausente en `ubicacion`. */
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Solo `ubicacion`. */
  lat?: number;
  lng?: number;
  address?: string;
};

/**
 * Mensaje de una conversacion web.
 *
 * El cursor de paginacion es `(created_at, id)`: dos mensajes pueden caer en
 * el mismo instante y el `id` desempata sin saltarse ninguno.
 * `client_message_id` lo genera el navegador para que un reintento tras un
 * corte de red no duplique el mensaje.
 */
@Entity('messages', { schema: 'public' })
@Index('idx_messages_conversation_created', [
  'conversationId',
  'createdAt',
  'id',
])
@Index(
  'uq_messages_conversation_client_message',
  ['conversationId', 'clientMessageId'],
  { unique: true, where: `"client_message_id" IS NOT NULL` },
)
@Index('idx_messages_receipt_validation', ['receiptValidationId'])
export class Message {
  @PrimaryColumn('uuid', {
    name: 'id',
    default: () => 'gen_random_uuid()',
    primaryKeyConstraintName: 'pk_messages',
  })
  id: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'fk_messages_conversation',
  })
  conversation: Conversation;

  @Column({
    type: 'enum',
    enum: MESSAGE_SENDERS,
    enumName: 'messages_sender_enum',
  })
  sender: MessageSender;

  @Column('text', { default: '' })
  body: string;

  @Column('jsonb', { nullable: true })
  attachment: MessageAttachment | null;

  // SET NULL: si se depura una validacion el mensaje sigue en el historial.
  @Column('uuid', { name: 'receipt_validation_id', nullable: true })
  receiptValidationId: string | null;

  @ManyToOne(() => PaymentReceiptValidations, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'receipt_validation_id',
    foreignKeyConstraintName: 'fk_messages_receipt_validation',
  })
  receiptValidation: PaymentReceiptValidations | null;

  @Column('uuid', { name: 'client_message_id', nullable: true })
  clientMessageId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
