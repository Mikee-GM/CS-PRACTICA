---
trigger: always_on
description: Reglas de arquitectura Heavy DB y precisión de tipos para NestJS y PostgreSQL
---

# RULES.md — NestJS & Backend Best Practices

## 1. Arquitectura del Proyecto

- **Modularidad estricta**: cada feature vive en su propio módulo (`*.module.ts`) con sus controllers, services, DTOs y entities. Nunca mezclar lógica de dominios distintos en un mismo módulo.
- **Separación por capas**: Controller (HTTP) → Service (lógica de negocio) → Repository/Provider (acceso a datos). El controller NUNCA debe contener lógica de negocio.
- **Dependency Inversion**: los servicios dependen de interfaces/abstracciones, no de implementaciones concretas. Esto permite testear con mocks fácilmente y facilita el mantenimiento a largo plazo.
- **Shared Module**: utilidades, pipes, guards y decoradores reutilizables van en un `SharedModule` o `CommonModule`, evitando duplicación.
- Adoptar Clean Architecture cuando el proyecto crezca: separar `domain`, `application` e `infrastructure` para que la lógica de negocio no dependa de frameworks externos.

## 2. DTOs y Validación

- Usar siempre `class-validator` + `class-transformer` con `ValidationPipe` global (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`).
- Un DTO por operación (`CreateUserDto`, `UpdateUserDto`), nunca reutilizar entidades como DTOs de entrada/salida.
- Usar `PartialType()` de `@nestjs/mapped-types` para DTOs de actualización en lugar de duplicar campos.
- Nunca expongas entidades de base de datos directamente en las respuestas; usa DTOs de salida o `class-transformer` con `@Exclude()`.

## 3. Manejo de Errores

- Centralizar el manejo de errores con `Exception Filters` globales (`@Catch()`).
- Usar las excepciones nativas de Nest (`BadRequestException`, `NotFoundException`, etc.) en lugar de lanzar errores genéricos.
- Nunca dejar que errores internos (stack traces, mensajes de DB) lleguen al cliente; loguear el detalle internamente y devolver mensajes controlados.
- Estandarizar el formato de respuesta de error (código, mensaje, timestamp, path) para consistencia en toda la API.

## 4. Seguridad

- Aplicar `Helmet`, `CORS` configurado explícitamente (no `*` en producción) y rate limiting (`@nestjs/throttler`).
- Autenticación con JWT + refresh tokens; usar `Guards` (`AuthGuard`) y `Strategies` de Passport en lugar de validación manual en controllers.
- Autorización basada en roles/permisos con `Guards` personalizados y decoradores (`@Roles()`).
- Sanitizar y validar TODO input del usuario, incluso en queries y params, no solo en el body.
- Nunca guardar secretos en el código; usar `@nestjs/config` con variables de entorno y esquemas de validación (`Joi` o `zod`).
- Mantener dependencias actualizadas y correr auditorías de seguridad (`npm audit`, `snyk`) periódicamente.

## 5. Base de Datos

- Usar un ORM/Query Builder consistente (TypeORM, Prisma o MikroORM) y evitar mezclar accesos SQL crudos salvo casos justificados.
- Repositorios como capa de abstracción: los servicios no deben llamar directamente al ORM, sino a través de un repository/provider inyectado.
- Migraciones versionadas y automatizadas, nunca cambios manuales en el esquema de producción.
- Usar transacciones (`QueryRunner` / `$transaction`) para operaciones que afecten múltiples tablas.
- Índices y paginación obligatorios en endpoints que devuelven colecciones grandes.

## 6. Testing

- Cobertura mínima con tests unitarios (services, pipes, guards) usando Jest y mocks de dependencias vía DI.
- Tests de integración (`e2e`) para los flujos críticos de la API usando `supertest` + `TestingModule`.
- Nunca testear implementación interna; testear comportamiento observable (inputs/outputs).
- Usar fixtures y factories para datos de prueba en lugar de hardcodear objetos repetidos.

## 7. Performance & Escalabilidad

- Usar `Caching` (`@nestjs/cache-manager` con Redis) para endpoints de lectura frecuente y baja mutabilidad.
- Procesos pesados o asíncronos van a colas (`@nestjs/bull` / BullMQ), nunca bloquear el request-response con tareas largas.
- Habilitar compresión (`compression` middleware) y lazy loading de módulos poco usados.
- Monitorear con APM (New Relic, Datadog, OpenTelemetry) y logs estructurados (`pino` o `winston`) en producción.
- Para microservicios, usar los transportes nativos de Nest (TCP, Redis, Kafka, gRPC) en lugar de HTTP interno entre servicios cuando el rendimiento sea crítico [[1]](#\_\_1).

## 8. Configuración & Entornos

- `@nestjs/config` con validación de esquema al arranque; la app no debe iniciar si falta una variable crítica.
- Separar configuración por entorno (`.env.development`, `.env.production`) sin subir secretos al repo.
- Usar `ConfigService` inyectado, nunca `process.env` disperso por el código.

## 9. Documentación de API

- Swagger/OpenAPI (`@nestjs/swagger`) siempre sincronizado con los DTOs reales mediante decoradores (`@ApiProperty()`).
- Versionar la API desde el inicio (`/v1`, `/v2`) usando el versioning nativo de Nest.
- Documentar códigos de error posibles por endpoint, no solo el caso feliz.

## 10. Estilo de Código & Mantenibilidad

- ESLint + Prettier obligatorios con reglas consistentes en todo el equipo/agente.
- Nombrado consistente: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.dto.ts`, `*.entity.ts`.
- Principio de responsabilidad única: un service no debe superar una responsabilidad clara; si crece demasiado, dividir.
- Comentarios solo donde el "por qué" no es obvio; el código debe explicarse por sí mismo mediante buen naming.
- Revisar estas reglas contra el 40%+ de mejora en mantenibilidad reportado en encuestas de la comunidad NestJS al adoptar arquitecturas modulares consistentes [[2]](#\_\_2).

# Reglas de Arquitectura "Heavy DB" (NestJS & PostgreSQL)

Este proyecto sigue la filosofía de diseño **Heavy DB (Antigravity)**, donde delegamos la lógica de negocio, consistencia, integridad de datos y cálculos costosos directamente a PostgreSQL utilizando Triggers y Funciones/Procedimientos Almacenados. NestJS actúa como un orquestador eficiente.
