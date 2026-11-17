import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Clientes } from '../../clients/entities/client.entity';
import { Post } from './post.entity';

/**
 * Like de un cliente a un post. La llave primaria compuesta hace que dar like
 * dos veces sea un conflicto y no una fila repetida; el trigger de la
 * migracion suma o resta `posts.like_count` en cada alta o baja.
 *
 * El indice por cliente es descendente en la migracion ("mis likes" mas
 * recientes primero); TypeORM no expresa el orden.
 */
@Entity('post_likes', { schema: 'public' })
@Index('idx_post_likes_client_created', ['clientId', 'createdAt'])
export class PostLike {
  @PrimaryColumn('uuid', {
    name: 'post_id',
    primaryKeyConstraintName: 'pk_post_likes',
  })
  postId: string;

  @PrimaryColumn('uuid', {
    name: 'client_id',
    primaryKeyConstraintName: 'pk_post_likes',
  })
  clientId: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'post_id',
    foreignKeyConstraintName: 'fk_post_likes_post',
  })
  post: Post;

  @ManyToOne(() => Clientes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'client_id',
    foreignKeyConstraintName: 'fk_post_likes_client',
  })
  client: Clientes;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
