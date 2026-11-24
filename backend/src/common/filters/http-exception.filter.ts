import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/** Multer no exporta su clase de forma estable: se reconoce por nombre y code. */
function esErrorDeMulter(
  exception: unknown,
): exception is Error & { code: string } {
  return (
    exception instanceof Error &&
    exception.name === 'MulterError' &&
    typeof (exception as { code?: unknown }).code === 'string'
  );
}

/**
 * Errores de `body-parser` (http-errors): traen su propio `status` 4xx y
 * `expose: true`. El caso real es `entity.too.large`: sin reconocerlos, un
 * cuerpo de mas de 100 KB llegaba como 500 y se registraba como fallo del
 * servidor.
 */
function esErrorDeCliente(
  exception: unknown,
): exception is Error & { status: number } {
  if (!(exception instanceof Error)) return false;
  const { status, expose } = exception as {
    status?: unknown;
    expose?: unknown;
  };
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    expose === true
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    // Los filtros globales tambien envuelven handlers que no son HTTP, y ahi no
    // hay respuesta que escribir: `response.status(...)` revienta, sustituyendo
    // el error real por un `response.status is not a function` que no dice
    // nada. Se deja subir la excepcion para que la recoja quien corresponda.
    if (host.getType() !== 'http') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exceptionResponse;
        error = (exceptionResponse as any).error || exception.name;
      } else {
        message = exceptionResponse;
        error = exception.name;
      }
    } else if (esErrorDeMulter(exception)) {
      // Nest traduce los errores de Multer comparando su mensaje con textos
      // fijos, y Multer 2 los redacta distinto ("Unexpected file field"), asi
      // que llegaban aqui como 500. Se resuelve por `code`, que es estable.
      status =
        exception.code === 'LIMIT_FILE_SIZE'
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST;
      error = status === 413 ? 'Payload Too Large' : 'Bad Request';
      message =
        status === 413
          ? 'El archivo supera el tamano maximo permitido.'
          : 'La subida de archivos no es valida: revisa los campos y la cantidad de archivos.';
    } else if (esErrorDeCliente(exception)) {
      status = exception.status;
      error = status === 413 ? 'Payload Too Large' : 'Bad Request';
      message =
        status === 413
          ? 'La peticion supera el tamano maximo permitido.'
          : 'La peticion no es valida.';
    } else if (exception instanceof QueryFailedError) {
      // Safely catch database constraint violations without leaking raw query details to the client
      const dbError = exception as unknown as { code?: string };
      const code = dbError.code;

      if (code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'El registro ya existe (violación de clave única).';
        error = 'Conflict';
      } else if (code === '23503') {
        status = HttpStatus.BAD_REQUEST;
        message =
          'No se pudo realizar la operación debido a una restricción de clave foránea.';
        error = 'Foreign Key Constraint';
      } else if (code === '23514') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Violación de restricción check en base de datos.';
        error = 'Check Constraint';
      } else if (code?.startsWith('22') || code?.startsWith('23')) {
        // Clase 22 (dato mal formado: un uuid o un numero invalido) y el resto
        // de la 23 (not null...) vienen de lo que mando el cliente.
        status = HttpStatus.BAD_REQUEST;
        message = 'Los datos enviados no son válidos.';
        error = 'Database Error';
      }
      // Cualquier otro codigo (deadlock, tiempo agotado, tabla o columna que
      // no existe, conexion caida) es un fallo del servidor, no del cliente:
      // se queda como 500 y se registra con error en vez de con warn, que es
      // lo que hacia pasar un incidente por una peticion mal formada.
    }
    // Cualquier otra cosa se queda como 500 con un texto fijo: el mensaje de un
    // Error interno puede llevar rutas de fichero, hosts o credenciales, y no
    // tiene por que llegar al cliente. El detalle completo va al log de abajo.

    // Log the error internally with appropriate severity levels
    const logMessage = `${request.method} ${request.url} - Status: ${status} - Error: ${
      exception instanceof Error
        ? exception.message
        : typeof exception === 'object' && exception !== null
          ? JSON.stringify(exception)
          : String(exception)
    }`;

    if (status >= 500) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logMessage);
    }

    const errorResponse = {
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }
}
