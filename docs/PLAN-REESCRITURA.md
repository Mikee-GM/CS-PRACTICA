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

### Fase 2, paso 1

Prompt y barreras de la IA por canal (`CanalChat = 'telegram' | 'web'`). Todo
lo que no recibe canal se comporta como Telegram, que no cambia: el prompt de
Telegram se comparo byte a byte antes y despues del cambio y es identico.

- `ai/prompts/prompts.ts`: `EmpleadaPromptParams.canal` (por defecto
  `telegram`). Las reglas fijas pasan a ser una por canal
  (`REGLAS_PERMANENTES` y `REGLAS_PERMANENTES_WEB`), cada una estable para no
  perder la cache de prefijo. En web:
  - La REGLA #0 conserva nombre artistico, tono y no revelar nombre real ni
    ubicacion, deja de negar ser IA y de vetar "bot", "IA", "inteligencia
    artificial", "asistente" y "automatico", y mantiene vetadas las palabras de
    estructura interna (sistema, plataforma, agencia, jefe, empleada, modelo...).
    Ante la pregunta en serio, la verdad en una frase corta y seguir en tono.
  - Las justificaciones de los desvios ya no dependen de ocultar que es IA; el
    comportamiento (no anunciar "no puedo", desviar con gracia, no hacer
    encargos) es el mismo.
  - Sin menciones a Telegram ("este chat"), sin instruccion de emojis y sin el
    emoji del ejemplo de `[TRIO_REQUEST]`.
- `ai/ai-guardrails.ts`: `detectBotProbe` se parte en `detectJailbreak`,
  `detectIdentityQuestion` y `detectTareaAjena`; `detectSonda(mensaje, canal)`
  las combina y en web deja pasar la pregunta de identidad al modelo.
  `detectBotProbe` queda como `detectSonda(mensaje, 'telegram')`.
  `looksLikeAssistantRegister(reply, { permitirIdentidad })` admite en web que
  se declare IA, pero sigue descartando "como asistente...", las negativas de
  politica y "soy un modelo de lenguaje". `IN_CHARACTER_DEFLECTIONS_WEB` y
  `pickDeflection(previo, canal)` dan desvios sin emojis. `quitarEmojis` y
  `limitarEmojis(..., { canal: 'web' })` eliminan todos los emojis; un mensaje
  que era solo un emoji queda vacio y quien lo llame debe desviar.

Pendiente:

- Nadie usa todavia el canal web: el servicio de chat web (pasos siguientes)
  tiene que llamar a `getHireSystemPrompt({ canal: 'web' })`, `detectSonda(m,
  'web')`, `looksLikeAssistantRegister(r, { permitirIdentidad: true })`,
  `pickDeflection(p, 'web')` y `limitarEmojis(t, n, { canal: 'web' })`, y tratar
  la respuesta vacia como descartada.
- `detectIdentityQuestion` solo reconoce "eres una IA/bot/robot/asistente...",
  igual que antes. Formulas como "hablo con una persona?" o "eres real?" no se
  detectan; en web no hace falta porque pasan al modelo igualmente.
- "Eres chatgpt?" sigue tratandose como jailbreak (nombra un proveedor) tambien
  en web y se desvia en vez de contestarse.
- El prompt web conserva excusas de personaje que no tocan la identidad, como
  "ahorita andas en la calle y no puedes oir audios" ante un adjunto; revisar
  cuando existan los adjuntos del chat web.

### Fase 2, paso 2 (modelo de datos del chat web)

- Nuevo modulo `conversations` con las entidades `Conversation` (tabla
  `conversations`) y `Message` (tabla `messages`), sin servicio ni endpoints
  todavia; Telegram sigue intacto.
- `conversations`: cliente, modelo elegida, borrador de reserva
  (`booking_session_id`, unico), servicio, `status`
  (`activa|en_revision|con_servicio|cerrada`), `mode`
  (`AI_ACTIVE|HUMAN_ACTIVE`, mismo vocabulario que `customer_booking_sessions`),
  jefe que tomo el control, `state` jsonb con `state_version` para bloqueo
  optimista y `last_message_at`. Una sola conversacion abierta por pareja
  cliente-modelo (indice unico parcial `WHERE status <> 'cerrada'`).
- `messages`: remitente (`cliente|ia|jefe|sistema`), cuerpo, adjunto jsonb
  (`MessageAttachment`), validacion de comprobante con FK y `client_message_id`
  unico por conversacion para que un reintento no duplique. Paginacion por
  cursor `(created_at, id)`.
- Llaves foraneas: cliente CASCADE, modelo RESTRICT (como `servicios`),
  borrador, servicio, jefe y validacion SET NULL; mensajes CASCADE con su
  conversacion.
- Migracion `1811001000000-AddWebConversations`, idempotente (`IF NOT EXISTS` y
  enums con `duplicate_object`). `conversations.entities.spec.ts` compara los
  metadatos de TypeORM con el texto de la migracion para que no diverjan.
- Pendiente: la migracion no se ha ejecutado contra una base real (Docker no
  estaba disponible); hay que correr `migration:run`, `migration:revert` y
  `migration:run` antes de desplegar. `Conversation` importa
  `CustomerBookingSession` desde `telegram-conversations`; moverlo al extraer
  el modulo `booking`.

### Fase 2, paso 3 (tanda A)

Nuevo modulo `booking/`, independiente del canal. Se movio solo logica pura,
por delegacion: `TelegramBookingUpdate` conserva sus metodos y firmas y los
specs de Telegram no se modificaron.

- `booking/booking-lifecycle.ts` (antes `telegram/telegram-booking-lifecycle.ts`,
  que queda como reexport) con su spec.
- `booking/chat-channel.ts`: contratos `ConversationRef`, `InboundMessage`,
  `ChatChannel` y `BookingStateStore<T>` (version optimista; `save` rechaza con
  `ConflictoDeVersionError`). Solo tipos, sin implementaciones.
- `booking/booking.errors.ts`: `LimiteDiarioDeIaError`, `ConflictoDeVersionError`.
- `booking/extractores-de-reserva.ts`: `extractHireDuration`,
  `extractHirePaymentMethod`, `detectGroupServiceIntent`,
  `detectOpenEndedDuration`, `buildModelKeys` (reexportados desde el handler).
- `booking/ubicaciones.ts`: `fueraDeCobertura`, `ubicacionPorNombre`,
  `ubicacionMencionadaEn`; el handler sigue leyendo area y ubicaciones y delega.
- `booking/datos-de-reserva.ts`: `DatosDeReserva`, `BorradorDeReserva`,
  `datosDeReserva` y `montoEsperadoDeTransferencia`.
- `BookingAiService.callModel` (en `BookingModule`): identifica al cliente por
  `clienteId`, cuenta la llamada en una sola sentencia atomica con el dia en
  hora de Mexico y hace cumplir `MAX_DAILY_AI_CALLS` lanzando
  `LimiteDiarioDeIaError` antes de llamar al proveedor. Telegram
  (`TelegramBookingService.getGroqResponse`) delega con
  `aplicarLimiteDiario: false`: hasta ahora el limite nunca se aplicaba y
  cortarlo en Telegram seria un cambio de comportamiento.
- Efecto lateral: el contador de Telegram cambia de dia a medianoche de Mexico
  y no a la del servidor; nadie lee ese contador fuera de este servicio.

Pendiente:

- Probar contra una base real la sentencia del contador (no habia Docker),
  sobre todo `AT TIME ZONE $3` y `$2::int IS NULL`.
- Registrar `BookingModule` en `AppModule` cuando lo use el modulo web (hoy
  llega a traves de `TelegramModule`).
- Decidir como responde el canal web a `LimiteDiarioDeIaError`.
- `telegram/telegram-booking-lifecycle.ts` ya no tiene importadores; se puede
  borrar.

### Fase 2, pasos 4 y 5

API REST del chat web para el cliente y canal SSE del cliente. Sin IA todavia.

- `ConversationsService` y `ConversationsController` (`/conversations`), todas
  las rutas con `JwtAuthGuard` + `RolesGuard` + `@Roles('cliente')`; las que
  escriben, ademas `CsrfGuard` y limite de ritmo (abrir chat 10/min, mensajes
  20/min).
  - `GET /conversations`: bandeja del cliente (hasta 100), con nombre artistico,
    slug y foto de perfil de la modelo (lo mismo que publica el catalogo),
    estado y ultimo mensaje recortado a 140 caracteres. No expone `mode`.
  - `POST /conversations` `{ employeeId }`: 201 si crea, 200 si devuelve la
    abierta. Valida que la modelo sea visible con el criterio de
    `EmployeesService.findAllActive`, replicado en una consulta puntual. La
    carrera del indice unico parcial se resuelve capturando la violacion y
    releyendo.
  - `GET /conversations/:id/messages?cursor=&limit=`: descendente, maximo 50. El
    cursor es el id del ultimo mensaje entregado y se compara por
    `(created_at, id)` en SQL. El adjunto solo entrega su tipo.
  - `POST /conversations/:id/messages` `{ body, clientMessageId }`: idempotente
    (201 nuevo, 200 reintento, sin eventos ni turno en el reintento), 409 si la
    conversacion esta cerrada (despues de comprobar la idempotencia). La
    conversacion se bloquea con `FOR UPDATE` mientras se inserta.
- Seguridad: todo parte de la ficha `Clientes` de la sesion. Una conversacion
  ajena o inexistente responde 404, y una cuenta sin ficha tambien.
- Eventos en `conversations/conversation-events.ts`: `message_created`,
  `conversation_mode_changed`, `receipt_status`, `typing`, con forma
  `{ type, data }` y solo ids. Cada mensaje del cliente emite `message_created`
  al cliente y a los jefes de la modelo.
- Punto de extension del paso 6: `CONVERSATION_TURN_HANDLER`
  (`ConversationTurnHandler.onClientMessage`), opcional. Se invoca tras el commit
  sin esperarlo y sus errores solo se registran.
- `GET /realtime/sse/cliente`: `JwtAuthGuard` y rol comprobado a mano; el resto
  de roles recibe 403. El proxy de Next (`/api/realtime/sse?canal=cliente`) ya lo
  conoce.

Pendiente:

- Ejecutar contra una base real la bandeja (`LATERAL`, `$2::uuid IS NULL`), la
  paginacion por cursor, el `FOR UPDATE` y la captura de la violacion del indice
  parcial (sin Docker).
- Decidir si el cliente ve el `mode` y como se sirven los adjuntos (paso 7).
- El criterio de visibilidad de la modelo esta duplicado respecto al catalogo.
- En `sse/chofer` (`PortalAuthGuard`, sin rol) un cliente recibe 404 y no 403:
  no abre canal, pero no es un rechazo explicito por rol.

### Fase 2, paso 9 (avisos del servicio al chat web)

- `ConversationNotifier.notifyClient({ clienteId, serviceId?, employeeId?, texto })`
  deja el aviso como mensaje `sistema` en el chat web del cliente, actualiza
  `last_message_at` con la fila bloqueada y emite `message_created` al cliente y
  a los jefes de la modelo. Busca primero la conversacion del servicio (por
  `service_id` o por el `booking_session_id` del servicio, aunque este cerrada)
  y, si no hay, la abierta mas reciente con la modelo; sin ninguna devuelve
  `false`. Nunca lanza.
- Vive en `ConversationNotifierModule`, que solo depende de la base;
  `ServicesModule` lo importa directo y `ConversationsModule` lo reexporta. Asi
  no se forma un ciclo cuando el turno de la IA cree servicios.
- Criterio de canales: cada aviso sale por todos los que tiene el cliente, una
  vez por canal. Telegram no cambia; el web se intenta solo si la ficha tiene
  `usuarioId`. Cuando el texto lo redacta la IA se pide una sola vez y se
  comparte entre canales (`unaVez`); para la web se le quitan los emojis y el
  Markdown de Telegram (`textoParaChatWeb`).
- Cubiertos en `services/`: aceptacion, rechazo, cancelacion manual, cancelacion
  por demora (texto web propio), reprogramacion, extension, fin proximo, nueva
  hora de llegada, sucesor agendado (disponible y en camino), ida en camino o
  llegada por Uber, y el recordatorio de 45 minutos del programador de citas.

Pendiente:

- Sin cubrir: llegada con chofer propio y cierre del regreso
  (`drivers/driver-trips.service.ts`); comprobante rechazado y cotizacion
  grupal (`group-services`); encuesta de calificacion (falta pantalla web);
  cuenta final de un servicio abierto (depende de los comprobantes, paso 7).
- El recordatorio de 45 minutos sigue dentro del ciclo que se apaga sin bot de
  Telegram; hay que desacoplarlo en la fase 5.
- Algunos textos reutilizados dicen "la empleada" o "la agencia", palabras que
  el prompt web veta a la IA; los avisos web deben llevar vocabulario propio.
- Al cancelar no se cierra la conversacion web, solo la sesion de Telegram.
- Probar contra una base real la consulta del notificador.

### Fase 2, paso 6 (turno de la IA en el chat web)

Un mensaje del cliente recibe respuesta y la reserva avanza hasta quedar en
revision para el jefe. Se construyo un turno web nuevo con las piezas puras de
`booking/` y `ai/`; el turno de Telegram no se movio y sus specs no cambiaron.
Hasta la Fase 6 hay logica parecida en dos sitios; el turno de Telegram se borra
entonces.

- `booking/booking-state.ts`: `BookingState` (subconjunto serializable de la
  sesion de reserva), `estadoInicial`, `normalizarEstado`, `requisitoPendiente`,
  `reiniciarReserva`.
- `booking/respuesta-ia.ts`, extraido de Telegram por delegacion:
  `vestirRespuestaIa`, `corregirRetrocesoDeDuracion`, `evaluarMarca`.
- `booking/marcas-de-control.ts`: lectura de `[DATA]` y `[GROUP_*]` y su
  corroboracion. Duracion, pago, motel y fecha solo se aplican si los dijo el
  cliente; el pago que propone el modelo ya no cuenta por si solo (mas estricto
  que Telegram). `[GROUP_*]` solo provoca una pregunta.
- `booking/booking.service.ts` (`BookingService.handleClientMessage`): barreras
  sin modelo, router global, extractores, pin con cobertura, prompt `web`,
  historial de 24 mensajes, `BookingAiService`, filtros de salida sin emojis,
  marcas corroboradas, loop breaker, promesa sin respaldo y cierre. Con duracion,
  ubicacion y pago completos se cierra sin llamar al modelo: borrador en
  `customer_booking_sessions` (con version), `booking_session_id`, `en_revision`,
  aviso al jefe y mensaje de sistema con el total (`money.ts`). Transferencia o
  mixto quedan "esperando comprobante".
- Errores: `LimiteDiarioDeIaError` da un mensaje fijo sin llamar al proveedor;
  un fallo del modelo da un mensaje neutro y `en_revision`; tras 3 seguidos, se
  entrega al equipo.
- `conversations/web-booking-state.store.ts` (estado con `state_version`),
  `web-chat-channel.ts` (cada salida es un `Message`; eventos `message_created`,
  `typing` y el nuevo `conversation_status_changed`) y `web-turn-handler.ts`,
  registrado como `CONVERSATION_TURN_HANDLER`.
- Concurrencia: `withAdvisoryLockPorClave` (`pg_try_advisory_lock(namespace,
  hashtext(id))`, namespace `ADVISORY_LOCKS.conversationTurn = 811_011`, no
  bloqueante) y un cursor `ultimoMensajeAtendidoId` en el estado. Rafagas
  agrupadas con `WEB_CHAT_DEBOUNCE_MS` (1500 por defecto) y pausa de escritura
  acotada por `WEB_CHAT_MAX_TYPING_DELAY_MS`.
- `POST /conversations/:id/messages` acepta
  `location: { lat, lng, address? }` (el cuerpo puede faltar si hay ubicacion);
  el pin se guarda como adjunto `ubicacion` y la cobertura la decide el turno.

Pendiente:

- Probar contra Postgres real el `UPDATE` en CTE, el cast a
  `conversations_status_enum`, el lock de dos enteros y las consultas del
  cursor; probar el turno con el modelo real.
- No portado a la web: trio, fotos, otras modelos, modelo ocupada, horarios
  ocupados y monto del pago mixto.
- Paso 7: comprobante y datos bancarios (`esperandoComprobante` ya queda puesto).
- Paso 8: quitar `entregadaAlEquipo` al devolver el control a la IA; la
  cancelacion con la reserva en revision solo avisa al equipo; comprobar que
  aceptar un borrador web no supone un cliente de Telegram.
- El loop breaker solo actua con la reserva arrancada; cambiar de modelo remite
  al catalogo; el aviso del limite diario se repite con cada mensaje; la entrega
  es al menos una vez (si el proceso cae entre responder y guardar el estado, se
  volveria a contestar).
- Frontend: boton de ubicacion y los eventos `typing` y
  `conversation_status_changed`.

### Fase 2, paso 9b (avisos del chofer propio y vocabulario web)

- `drivers/driver-trips.service.ts` avisa por el chat web de la llegada con
  chofer propio (`avisarLlegadaAlCliente`, con el texto de la IA compartido por
  `unaVez`) y del cierre del regreso (`cerrarServicioDeRegreso`). Telegram no
  cambia; el web se intenta si la ficha tiene `usuarioId`. El notificador entra
  `@Optional()` al final del constructor y `DriversModule` importa
  `ConversationNotifierModule` directo. Un fallo del aviso no deshace el viaje.
- `ai/vocabulario-vetado.ts` (`PALABRAS_VETADAS_WEB`, `palabrasVetadasEn`) es la
  lista unica de lo que no se dice en el chat web; el prompt web la enumera
  desde ahi. Compara palabras completas, sin mayusculas ni acentos.
- `avisarAlChatWeb` pasa todo texto por `textoWebSeguro`: sin emojis ni
  Markdown, "la empleada"/"la modelo" pasan al nombre artistico o a "quien te
  atiende", y desaparece la presentacion como asistente de la agencia. Si aun asi
  queda algo vetado, usa el respaldo del sitio; si tampoco, quita las frases que
  lo dicen, y si no queda nada no manda el aviso. Es la unica salida hacia
  `notifyClient` fuera de `conversations/`.
- Un spec recorre el texto base de los 17 avisos web y redacciones hostiles de la
  IA, y falla con cualquier palabra vetada o emoji.

Pendiente:

- Sin cubrir: comprobante rechazado y cotizacion grupal (`group-services`),
  encuesta de calificacion (falta pantalla web) y cuenta final de un servicio
  abierto (paso 7). En `transport-operations/` y `liquidations/` no hay avisos
  al cliente.
- Si alguien llama a `ConversationNotifier.notifyClient` sin pasar por
  `avisarAlChatWeb` (por ejemplo desde `booking/`), ese texto no pasa por el
  filtro de vocabulario.
- Al comparar sin acentos, "modelo" con tilde cuenta como "modelo".
- Probar contra una base real los avisos del chofer propio.
