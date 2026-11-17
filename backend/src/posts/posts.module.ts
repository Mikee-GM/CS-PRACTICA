import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { UploadModule } from '../upload/upload.module';
import { EmployeePostsController } from './employee-posts.controller';
import { PostLike } from './entities/post-like.entity';
import { PostMedia } from './entities/post-media.entity';
import { Post } from './entities/post.entity';
import { PostsService } from './posts.service';

// `PostsService` se exporta para el jefe (B5), que publica y modera con las
// mismas operaciones. AuthModule aporta el AuthService de PortalAuthGuard.
@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostMedia, PostLike]),
    AuthModule,
    EmployeesModule,
    UploadModule,
  ],
  controllers: [EmployeePostsController],
  providers: [PostsService],
  exports: [TypeOrmModule, PostsService],
})
export class PostsModule {}
