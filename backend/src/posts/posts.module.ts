import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostLike } from './entities/post-like.entity';
import { PostMedia } from './entities/post-media.entity';
import { Post } from './entities/post.entity';

// Por ahora solo registra las entidades del feed; los servicios y rutas de la
// modelo, el cliente y el jefe llegan en los pasos B3 a B5.
@Module({
  imports: [TypeOrmModule.forFeature([Post, PostMedia, PostLike])],
  exports: [TypeOrmModule],
})
export class PostsModule {}
