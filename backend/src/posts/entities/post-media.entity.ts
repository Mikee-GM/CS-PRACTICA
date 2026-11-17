import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { Post } from './post.entity';

export const POST_MEDIA_KINDS = ['imagen', 'video'] as const;
export type PostMediaKind = (typeof POST_MEDIA_KINDS)[number];

/**
 * Foto o video de un post, guardado en R2 bajo `posts/<employeeId>/`.
 *
 * `(post_id, position)` es unico pero diferido hasta el commit: reordenar la
 * media intercambia posiciones y, con la restriccion inmediata, el primer
 * UPDATE chocaria con la fila que aun no se ha movido.
 */
@Entity('post_media', { schema: 'public' })
@Unique('uq_post_media_post_position', ['postId', 'position'], {
  deferrable: 'INITIALLY DEFERRED',
})
@Check(
  'ck_post_media_poster_only_video',
  `"kind" = 'video' OR "poster_url" IS NULL`,
)
export class PostMedia {
  @PrimaryColumn('uuid', {
    name: 'id',
    default: () => 'gen_random_uuid()',
    primaryKeyConstraintName: 'pk_post_media',
  })
  id: string;

  @Column('uuid', { name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, (post) => post.media, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'post_id',
    foreignKeyConstraintName: 'fk_post_media_post',
  })
  post: Post;

  @Column({
    type: 'enum',
    enum: POST_MEDIA_KINDS,
    enumName: 'post_media_kind_enum',
  })
  kind: PostMediaKind;

  @Column('text')
  url: string;

  // Fotograma que genera el navegador; solo existe para video.
  @Column('text', { name: 'poster_url', nullable: true })
  posterUrl: string | null;

  // Deducido de los bytes al subir, nunca del mimetype del navegador.
  @Column('text', { name: 'mime_type' })
  mimeType: string;

  @Column('integer')
  bytes: number;

  @Column('integer', { nullable: true })
  width: number | null;

  @Column('integer', { nullable: true })
  height: number | null;

  // Lo informa el navegador y el backend NO lo verifica: no se transcodifica
  // ni se parsea el contenedor. Sirve para pintar la duracion; el tope real
  // es el de bytes, y el jefe ve el video completo antes de aprobar.
  @Column('integer', { name: 'duration_ms', nullable: true })
  durationMs: number | null;

  @Column('smallint')
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
