# Plan de reescritura: de Telegram a plataforma web

Etiqueta de retorno: `pre-web-rewrite` (estado previo a la reescritura).

## Decisiones tomadas

1. Red social: posts con foto o video y likes. Sin comentarios, historias ni
   seguidores por ahora.
2. Publican la modelo y el jefe. Todo post requiere aprobacion del jefe antes de
   ser visible.
3. La IA sigue coordinando el servicio en forma de roleplay con la personalidad
   de la modelo. No se porta la regla de negar ser IA: el chat muestra un
   encabezado discreto ("Asistente virtual de [modelo]") y, si el cliente
   pregunta en serio, la respuesta es honesta en una frase y sigue en tono.
4. Se trabaja en este repositorio.
5. Base de datos limpia: no hay migracion de clientes desde Telegram.

## Experiencia del cliente

Catalogo publico, eleccion de modelo, perfil de la modelo con forma de red
social y chat con el asistente para coordinar el servicio. Cuenta propia con
correo; la verificacion queda `pendiente` y no bloquea el acceso. Secciones:
feed, chats y perfil (calificacion y nivel; el nivel se define despues).

## Fases

| Fase | Contenido | Verificacion |
|---|---|---|
| 0. Limpieza | Borrar basura del repo, unificar claves de advisory lock | `pnpm check` verde |
| 1. Cuentas de cliente | Registro, 18+, verificacion de correo pendiente, login con cookies y CSRF | Registro, acceso sin verificar y verificacion posterior |
| 2. Chat web | `conversations` y `messages`, SSE, adjuntos de comprobantes; extraer la reserva de `telegram-booking.service.ts` a un modulo `booking` independiente del canal; take over humano | Reserva completa de punta a punta por el chat |
| 3. Feed | `posts`, `post_media`, `post_likes`; estados borrador, pendiente, aprobado, rechazado; cola de aprobacion del jefe y editor de la modelo | Modelo publica, jefe aprueba, cliente ve |
| 4. Perfil de cliente | Calificacion y nivel como campos separados | El cliente ve su calificacion |
| 5. Personal sin Telegram | Onboarding, vinculacion, reglamento, canal de equipo, grupos y servicios manuales pasan a web; notificaciones por SSE, web push y correo | Un servicio recorre todos los estados sin Telegram |
| 6. Retirar Telegram | Borrar `telegram` y `telegram-conversations`, `nestjs-telegraf`, variables y webhooks; migracion base unica que sustituye las actuales | `grep -ri telegram` limpio y compila |

La migracion base unica va al final de la fase 6, cuando el esquema ya se
estabilizo. Resuelve de paso las dos migraciones con el timestamp
`1798000000000` (`AddPushSubscriptions` y `AddServiceOfficeClose`): renombrarlas
ahora rompe los despliegues existentes.

## Pendientes

- Proveedor de correo transaccional para la verificacion.
- Moderacion automatica de imagenes antes de la cola del jefe.
- Definicion de nivel y calificacion del cliente.
- Verificacion de edad (18+) mas alla de la declaracion.

## Progreso

### Fase 0

- Eliminados `scratch/`, `scratch2/`, `scratch_old_corte/`,
  `erp-colombia-sexys.html`, `vps_logs.txt` y `clean_production.sql`
  (ninguno estaba referenciado).
- `ADVISORY_LOCKS` pasa a ser el unico registro de claves: el barrido de la
  outbox y el de sesiones ya no reutilizan 811_006 y 811_005.
- `eslint.ignoreDuringBuilds` se deja como esta: CI ya ejecuta `pnpm run lint`
  como paso propio antes del build, asi que quitarlo solo duplicaria el lint.

### Fase 1 (backend)

- Nuevo rol `cliente` en `usuarios`. La ficha `clientes` apunta a su cuenta con
  `usuario_id`; `telegram_chat_id` pasa a ser opcional.
- `POST /auth/register`: crea cuenta y ficha en una transaccion, exige declarar
  18+ y aceptar terminos, abre sesion con las mismas cookies y CSRF. Un correo
  repetido responde 409 (decision asumida: claridad para quien se registra a
  cambio de revelar que el correo existe; el endpoint tiene limite de ritmo).
- Verificacion de correo pendiente, sin bloquear el acceso:
  `POST /client-accounts/verify-email` (POST y no GET para que una
  previsualizacion no queme el enlace), `POST /client-accounts/resend-verification`
  y `GET /client-accounts/me`. En la base solo vive la huella del token.
- `Mailer` es un puerto; `LogMailer` deja el correo en el registro hasta elegir
  proveedor.
- `RolesGuard` niega a los clientes en toda ruta que no los nombre, para que un
  `@Roles` olvidado en el personal no quede abierto a cuentas que cualquiera
  puede crear.
- El login ya no distingue mayusculas en el correo.
- La migracion `1811000000000-AddClientAccounts` no se ha ejecutado contra una
  base real (Docker no estaba disponible); hay que correr
  `corepack pnpm migration:run` antes de desplegar.

### Fase 1 (frontend)

- Paginas `/registro`, `/ingresar`, `/verificar-correo` y `/cuenta`, con marco
  comun (`AuthShell`) y campos con validacion diferida (`Campo`): el error
  aparece al salir del campo o al intentar enviar, nunca mientras se escribe, y
  se refleja en `aria-invalid`.
- La confirmacion del correo es un boton, no una llamada automatica: los
  antivirus y previsualizaciones abren los enlaces de los correos.
- El middleware conoce el rol `cliente`: `/cuenta` sin sesion va a `/ingresar`
  (no al login del panel) y el personal que llegue ahi vuelve a su inicio.
- `apiFetch` acepta `loginPath` para que una sesion caducada en pantallas de
  cliente no mande al login del panel.
- Pendiente: enlace de acceso en el catalogo publico; verificacion visual en
  navegador (no se ha abierto la aplicacion corriendo).
- El build de Next compila, pero `next build` falla en el chequeo de tipos por
  `@playwright/test` y `@testing-library/react`, que no estan instalados en
  este entorno; hay que correr `pnpm install` antes de comprobarlo.
