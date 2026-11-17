import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Usuarios } from '../../users/entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const { user } = context.switchToHttp().getRequest<{ user?: Usuarios }>();
    if (!requiredRoles) {
      // Un cliente solo entra donde la ruta lo nombra. Sin esto, cualquier
      // metodo del personal que olvidara su @Roles quedaria abierto a las
      // cuentas de cliente, que cualquiera puede crear registrandose.
      return user?.rol !== 'cliente';
    }
    if (!user) {
      return false;
    }
    return requiredRoles.includes(user.rol);
  }
}
