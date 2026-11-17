import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clientes } from '../clients/entities/client.entity';
import { PostLike } from '../posts/entities/post-like.entity';
import { PostMedia } from '../posts/entities/post-media.entity';
import { Post } from '../posts/entities/post.entity';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

// Lado del cliente del feed. Va aparte de `PostsModule` (la modelo y el jefe)
// y registra las entidades por su cuenta en vez de importar ese modulo: solo
// lee posts aprobados y escribe likes, sin depender de su ciclo de revision.
@Module({
  imports: [TypeOrmModule.forFeature([Post, PostMedia, PostLike, Clientes])],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
