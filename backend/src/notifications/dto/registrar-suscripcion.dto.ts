import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Las claves con las que el navegador descifra el aviso. */
export class ClavesSuscripcionDto {
  @ApiProperty({ description: 'Clave publica del navegador' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  p256dh: string;

  @ApiProperty({ description: 'Secreto de autenticacion del navegador' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  auth: string;
}

/**
 * Servicios push de los navegadores. El endpoint lo elige el cliente y el
 * backend le hace una peticion HTTPS: sin lista, cualquier usuario registrado
 * podria apuntarlo a un host interno. Tras el host solo se admite `/` o el fin
 * del texto, asi que no caben credenciales ni puertos.
 */
export const ENDPOINT_PUSH_PERMITIDO =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)(\/|$)/;

export class RegistrarSuscripcionDto {
  /**
   * El limite existe porque este texto va a una columna indexada por unicidad y
   * lo elige el navegador: sin tope, un cliente manipulado podria mandar
   * kilobytes en cada alta.
   */
  @ApiProperty({
    description: 'URL del servicio de push del navegador',
    example: 'https://fcm.googleapis.com/fcm/send/...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Matches(ENDPOINT_PUSH_PERMITIDO, {
    message:
      'El endpoint no pertenece a un servicio push de navegador conocido',
  })
  endpoint: string;

  @ApiProperty({ type: ClavesSuscripcionDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ClavesSuscripcionDto)
  keys: ClavesSuscripcionDto;
}
