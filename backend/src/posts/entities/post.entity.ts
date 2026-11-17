import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Empleadas } from '../../employees/entities/employee.entity';
import { Usuarios } from '../../users/entities/user.entity';
import { PostMedia } from './post-media.entity';

export const POST_STATUSES = [
  'borrador',
  'pendiente',
  'aprobado',
  'rechazado',
  'archivado',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// Texto con CHECK y no enum: es el rol de la cuenta al publicar, un rastro de
// auditoria, y no debe cambiar si mas adelante cambia el rol de la cuenta.
export const POST_AUTHOR_ROLES = ['empleada', 'jefe', 'admin'] as const;
export type PostAuthorRole = (typeof POST_AUTHOR_ROLES)[number];

/**
 * Post del feed, publicado en el perfil de una modelo.
 *
 * El feed pagina por `(published_at, id)` descendente. Los indices de la
 * migracion son descendentes y parciales; TypeORM no expresa el orden de las
 * columnas, asi que aqui se declaran sin `DESC` (con `synchronize: false` solo
 * sirven de documentacion y para que `migration:generate` no los toque).
 */
@Entity('posts', { schema: 'public' })
@Index('idx_posts_feed', ['publishedAt', 'id'], {
  where: `"status" = 'aprobado'`,
})
@Index('idx_posts_employee_feed', ['employeeId', 'publishedAt', 'id'], {
  where: `"status" = 'aprobado'`,
})
@Index('idx_posts_employee_pending', ['employeeId', 'submittedAt'], {
  where: `"status" = 'pendiente'`,
})
@Index('idx_posts_employee_created', ['employeeId', 'createdAt'])
@Check('ck_posts_author_role', `"author_role" IN ('empleada', 'jefe', 'admin')`)
@Check('ck_posts_caption_length', `char_length("caption") <= 2000`)
@Check('ck_posts_like_count', `"like_count" >= 0`)
@Check(
  'ck_posts_rejection_reason',
  `"status" <> 'rechazado' OR "rejection_reason" IS NOT NULL`,
)
// reviewed_by queda fuera del CHECK a proposito: la FK es SET NULL y borrar a un
// jefe que aprobo posts no debe fallar por la restriccion.
@Check(
  'ck_posts_approved_review',
  `"status" <> 'aprobado' OR "published_at" IS NOT NULL`,
)
export class Post {
  @PrimaryColumn('uuid', {
    name: 'id',
    default: () => 'gen_random_uuid()',
    primaryKeyConstraintName: 'pk_posts',
  })
  id: string;

  // RESTRICT, como en `conversations`: borrar a una empleada no debe llevarse
  // en silencio lo que publico ni sus likes.
  @Column('uuid', { name: 'employee_id' })
  employeeId: string;

  @ManyToOne(() => Empleadas, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'employee_id',
    foreignKeyConstraintName: 'fk_posts_employee',
  })
  employee: Empleadas;

  // Quien lo escribio: la modelo o un jefe/admin en su nombre.
  @Column('uuid', { name: 'author_user_id', nullable: true })
  authorUserId: string | null;

  @ManyToOne(() => Usuarios, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'author_user_id',
    foreignKeyConstraintName: 'fk_posts_author_user',
  })
  authorUser: Usuarios | null;

  @Column('text', { name: 'author_role' })
  authorRole: PostAuthorRole;

  @Column('text', { default: '' })
  caption: string;

  @Column({
    type: 'enum',
    enum: POST_STATUSES,
    enumName: 'posts_status_enum',
    default: 'borrador',
  })
  status: PostStatus;

  @Column('timestamp with time zone', { name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @Column('uuid', { name: 'reviewed_by', nullable: true })
  reviewedById: string | null;

  @ManyToOne(() => Usuarios, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'reviewed_by',
    foreignKeyConstraintName: 'fk_posts_reviewed_by',
  })
  reviewedBy: Usuarios | null;

  @Column('timestamp with time zone', { name: 'reviewed_at', nullable: true })
  reviewedAt: Date | null;

  @Column('text', { name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  // Se fija al aprobar y es la clave de orden del feed.
  @Column('timestamp with time zone', { name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column('timestamp with time zone', { name: 'archived_at', nullable: true })
  archivedAt: Date | null;

  // Lo mantiene el trigger de `post_likes`. Ni insert ni update desde TypeORM:
  // un `save` con la entidad leida antes de un like pisaria el contador.
  @Column({
    type: 'integer',
    name: 'like_count',
    default: 0,
    insert: false,
    update: false,
  })
  likeCount: number;

  @OneToMany(() => PostMedia, (media) => media.post)
  media: PostMedia[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
