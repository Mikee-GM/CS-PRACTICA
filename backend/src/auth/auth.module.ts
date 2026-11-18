import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientAccountsModule } from '../client-accounts/client-accounts.module';
import { Usuarios } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';
import { AuthCleanupScheduler } from './auth-cleanup.scheduler';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuarios, AuthSession]),
    ClientAccountsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // registerAsync + getOrThrow: sin JWT_SECRET el proceso falla al arrancar,
    // en vez de firmar tokens con un secreto por defecto publicado en el repo.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthCleanupScheduler, JwtStrategy, CsrfGuard],
  exports: [AuthService, JwtStrategy, CsrfGuard, PassportModule, JwtModule],
})
export class AuthModule {}
