import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { Empleadas } from '../employees/entities/employee.entity';
import { UploadModule } from '../upload/upload.module';
import { EmployeePostsController } from './employee-posts.controller';
import { PostLike } from './entities/post-like.entity';
import { PostMedia } from './entities/post-media.entity';
import { Post } from './entities/post.entity';
import { PostsService } from './posts.service';
import { StaffPostsController } from './staff-posts.controller';
import { StaffPostsService } from './staff-posts.service';

// `PostsService` se exporta para quien publique o modere con las mismas
// operaciones. AuthModule aporta el AuthService de PortalAuthGuard. `Empleadas`
// se registra aqui para resolver el alcance del jefe sin importar
// ConversationsModule. RealtimeEventsService llega del modulo global.
@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostMedia, PostLike, Empleadas]),
    AuthModule,
    EmployeesModule,
    UploadModule,
  ],
  controllers: [EmployeePostsController, StaffPostsController],
  providers: [PostsService, StaffPostsService],
  exports: [TypeOrmModule, PostsService],
})
export class PostsModule {}
