import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Usuarios } from '../../users/entities/user.entity';

/**
 * Enlace de verificacion de correo. En la base solo vive la huella del token:
 * un volcado de la tabla no permite verificar cuentas ajenas.
 */
@Index('uq_verificaciones_correo_token', ['tokenHash'], { unique: true })
@Index('idx_verificaciones_correo_usuario', ['usuarioId'])
@Entity('verificaciones_correo', { schema: 'public' })
export class VerificacionCorreo {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'usuario_id' })
  usuarioId: string;

  @ManyToOne(() => Usuarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuarios;

  @Column('char', { name: 'token_hash', length: 64 })
  tokenHash: string;

  @Column('timestamp with time zone', { name: 'expira_at' })
  expiraAt: Date;

  @Column('timestamp with time zone', { name: 'usado_at', nullable: true })
  usadoAt: Date | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;
}
