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

### Fase 2, paso 10 (frontend del chat web del cliente)

- Paginas `/chats` (bandeja) y `/chats/[id]` (conversacion), `noindex`, con
  `getCurrentUser`, `optionalSource`, `lib/data/conversaciones.ts` y Server
  Actions en `lib/actions/conversaciones.ts` (abrir chat, enviar mensaje, subir
  comprobante). El inicio del cliente pasa a `/chats`; `/cuenta` enlaza alli.
- Componentes en `components/cliente/`: `ListaChats`, `VistaChat`, `Burbuja`,
  `EncabezadoAsistente` (fijo, "Asistente virtual de X"; `jefe` se pinta como la
  modelo y `sistema` como aviso centrado), `BarraEscritura` (Enter envia solo con
  puntero fino y es seguro con IME; ubicacion con confirmacion previa y
  alternativa de escribir la direccion), `SubirComprobante`, `AvatarModelo`,
  `BotonChatear`, `AccesoCliente` y el canal `useCanalCliente`.
- Logica pura probada en `lib/conversaciones.ts`: mezcla de mensajes
  (optimistas al final, sustituidos por `clientMessageId`), cursor, deteccion de
  huecos tras caidas del canal y regla del comprobante.
- Accesibilidad: historial y paginas antiguas fuera del `role="log"`; solo lo
  nuevo se anuncia. Errores en `role="alert"`; objetivos de 44 px; sin animacion
  con `prefers-reduced-motion`; `interactiveWidget: "resizes-content"` para que
  el teclado no tape la barra.
- Catalogo: boton "Chatear" en el perfil y accesos "Iniciar sesion / Crear
  cuenta / Mis chats" sobre el Hero. Sin sesion se vuelve con `siguiente` a
  `/chats?modelo=<id>`, que ofrece abrir el chat sin crearlo al cargar.
  `destinoSeguroDelCliente` limita `siguiente` a pantallas del cliente.
- Middleware: `/chats` y `/chats/*` en la rama del cliente y en el `matcher`.

Pendiente:

- Verificacion en navegador y contra un backend real: teclado movil, area segura,
  SSE, geolocalizacion, subida y compresion del comprobante.
- Backend: falta `GET /conversations/:id` (la cabecera sale de la bandeja), un
  indicador explicito de comprobante pendiente en el resumen (hoy se deduce del
  texto del aviso) y un evento de fin de `typing`.
- El aviso de correo sin verificar solo se ve en `/cuenta`.
- `next build` cae en el chequeo de tipos por `@playwright/test` y 14 suites de
  jest por `jest-environment-jsdom`, ambos sin instalar.

### Fase 2, paso 7 (comprobantes por transferencia en el chat web)

- `booking/booking-receipts.ts`, extraido de Telegram por delegacion (los specs
  de Telegram no cambiaron): `parseReceiptAmount` y `validateReceiptAnalysis`
  (movidos y reexportados; el monto se compara en centavos),
  `registrarValidacion` (registro en `PROCESANDO` a partir de una imagen ya
  subida; la descarga con `getFileLink` se queda en Telegram),
  `aplicarAnalisis`/`guardarAnalisis`, `marcarErrorDeValidacion`,
  `comprobanteEnCurso`, `enlazarComprobanteAServicio`,
  `montoEsperadoDelComprobante` y `cuentasParaTransferir`. Son funciones que
  reciben sus repositorios porque los specs de Telegram construyen el handler a
  mano.
- `validarComprobanteDeReserva` no se extrajo (depende de `ctx` y de la sesion);
  la web compone las piezas puras en `ConversationReceiptsService.analizar`.
- `POST /conversations/:id/receipt` (multipart `file` y `clientMessageId`
  opcional; `@Roles('cliente')`, CSRF, 6/min, Multer con tope de 10 MB y solo
  JPEG/PNG/WEBP). 201 nuevo, 200 reintento sin subir ni analizar, 404 ajena,
  409 si no hay pago por transferencia pendiente, si la conversacion esta
  cerrada o si ya hay un comprobante en analisis (menos de 3 min), en revision o
  aprobado. El tipo real lo decide `uploadEvidence` por los bytes.
- El analisis deja un mensaje `sistema` y emite `receipt_status`
  (`recibido|en_revision|rechazado|error`) al cliente y a los jefes. Ningun
  estado confirma el dinero: sigue haciendo falta el CEP. Sin monto acordado va
  a revision manual. Una clave SPEI que ya confirmo otro pago se rechaza (mismo
  criterio que `uq_receipt_confirmed_spei_key`, adelantado al analisis). Salvo
  en el rechazo, la conversacion queda en `en_revision` y se avisa al equipo.
  Un fallo del analisis deja `ERROR_VALIDACION` y el cliente puede reenviar; no
  hay trabajo periodico.
- Cambio de contrato: `MensajeDelChat.attachment` es `{ type, url? }`; en
  `comprobante` y `foto` lleva la URL publica de R2 para el propio cliente.
- Al cerrar una reserva por transferencia o mixto, mensaje `sistema` con el
  monto (`money.ts`) y las cuentas activas (o `BANK_ACCOUNT_DETAILS`).

Pendiente:

- Probar contra Postgres real las consultas del ultimo comprobante y de la
  clave SPEI, el bloqueo y el filtro de servicios; probar con xAI y R2 reales.
- Con la reserva en borrador no hay servicio: al aceptar el borrador (paso 8)
  hay que enlazar el comprobante para poder confirmar el CEP.
- Pago mixto: la web no pregunta la parte por transferencia; sus comprobantes
  van siempre a revision manual.
- Sin portar: cobro final de duracion abierta y comprobante grupal.
- El prompt web sigue con `comprobanteRecibido: false`.
- `ERROR_VALIDACION` no se puede confirmar desde el panel.
- Una imagen puede quedar huerfana en R2 si dos reintentos llegan a la vez.
- `cuentasParaTransferir` repite el formato de `bankTransferDetails`.

### Fase 2, paso 8 (lado del equipo en el chat web)

- `StaffConversationsController` (`/staff/conversations`), separado del del
  cliente: todas las rutas con `JwtAuthGuard` + `RolesGuard` +
  `@Roles('admin','jefe')`; las que escriben, ademas `CsrfGuard` y limite de
  ritmo. Bandeja (`GET`, con `estado` y `q`; sin `estado`, todo menos
  `cerrada`), mensajes con coordenadas del pin, `take-over`, `release`,
  `messages`, `accept` y `reject`.
- Alcance (`conversations/alcance-del-jefe.ts`): el admin ve todo; un jefe, las
  modelos de las que es principal o secundario y, si ninguno de los dos puede
  atender (`puedeAtender`, ahora en `services/puede-atender.ts`), cualquiera.
  Fuera de alcance, 404.
- Toma de control con un UPDATE condicionado: de dos jefes gana uno y el otro
  recibe 409 con quien la tiene; el admin fuerza con `forzar`. Aviso `sistema`
  al cliente ("Una persona del equipo continua esta conversacion contigo.").
  `conversation_mode_changed` solo va a los jefes.
- Devolver el control quita `entregadaAlEquipo` con version optimista, retrocede
  el cursor hasta la ultima respuesta que no sea del cliente y lanza
  `procesarPendientes`: la IA contesta lo que quedo sin respuesta.
- Mensaje del equipo: solo en `HUMAN_ACTIVE` y por quien la tomo (o un admin),
  idempotente, sin emojis, guardado como `jefe`.
- Aceptar: `booking/aceptacion-de-borrador.ts`, extraido de `acceptBookingDraft`
  por delegacion (los specs de Telegram no cambian). La web no supone un cliente
  de Telegram. Enlaza `service_id`, pasa a `con_servicio`, enlaza el ultimo
  comprobante vigente al servicio (y el analisis que termine despues lo enlaza
  tambien), deja el estado en `SERVICE_CREATED` y avisa al cliente. Con servicio
  la IA ya no contesta; la bandeja marca `cliente_sin_respuesta`. Un jefe de
  relevo se queda con el servicio.
- Rechazar: borrador `CANCELLED` con el motivo en `metadata.rechazo`; la
  conversacion no se cierra (vuelve a `activa`, sin borrador, reserva reiniciada
  conservando la entrega al equipo) y aviso neutro al cliente.
- Cliente: `GET /conversations/:id`; `comprobantePendiente` en el resumen, con el
  mismo criterio que la subida (`conversations/comprobante-pendiente.ts`);
  `typing` lleva `activo` y el turno lo apaga al terminar, tambien con error.

Pendiente:

- Probar contra Postgres real los UPDATE en CTE, los `::text[]` sobre enums, el
  LATERAL del comprobante y el ILIKE; probar las rutas de punta a punta.
- La cancelacion del cliente con la reserva en revision sigue solo avisando; el
  equipo la resuelve con `reject`.
- El comprobante de una solicitud rechazada queda sin servicio; falta decidir el
  reembolso.
- Un jefe de relevo que no actuo no recibe los SSE de esas conversaciones.
- La bandeja trae 200 como mucho y ordena por atencion despues del LIMIT.
- Frontend del panel del equipo (paso 11).

## Fase 3: feed de posts (decisiones tomadas)

Plan del planificador resuelto con sus recomendaciones; la unica diferencia es el
tope de video.

- Solo posts con foto o video y likes. Visibles solo para clientes con sesion y
  declaracion 18+ (`/feed` general y `/modelos/[slug]`).
- Estados: borrador, pendiente, aprobado, rechazado, archivado. Un post aprobado
  que se edita vuelve a pendiente y se oculta hasta nueva aprobacion (conserva
  likes). "Borrar" por la modelo archiva; solo borrador y rechazado se borran de
  verdad, con su media en R2.
- Los posts de un jefe o admin se aprueban al enviarlos, solo para modelos
  dentro de su alcance, con rastro (`author_role`, `reviewed_by`).
- Media: imagenes JPEG/PNG/WEBP; video MP4 y WebM (MOV solo si es MP4 compatible),
  validados por bytes. Tope de video 20 MB y 30 s declarados, hasta 10 medias y
  3 videos por post; poster generado en el navegador; sin transcodificacion y
  sin autoplay con sonido. Se mantiene el limite de body de Next (20 MB); subir a
  50 MB queda para una fase con URLs prefirmadas. El jefe verifica el video
  completo antes de aprobar.
- Contador de likes desnormalizado con trigger (filosofia Heavy DB).
- Lo aprobado es publico para quien tenga la URL (bucket publico, sin politica de
  retencion por ahora). La moderacion automatica y la verificacion de edad
  reforzada siguen pendientes: esta fase no las cierra.
- Pasos: B1 migracion y entidades, B2 subida de media, B3 API de la modelo, B4
  API del cliente, B5 API del jefe, B6 avisos, F0-F4 frontend, I1 integracion.

### Fase 3, B1 y B2

Modelo de datos del feed y subida de media. Sin servicios ni rutas todavia.

- Nuevo modulo `posts` (`PostsModule`, registrado en `AppModule`) con las
  entidades `Post` (`posts`), `PostMedia` (`post_media`) y `PostLike`
  (`post_likes`). Migracion `1811002000000-AddFeedPosts`, idempotente y con
  `down` completo.
- `posts`: modelo (RESTRICT), autor (`author_user_id` SET NULL, `author_role`
  con CHECK `empleada|jefe|admin`), `caption` <= 2000, `status`
  (`borrador|pendiente|aprobado|rechazado|archivado`), fechas de envio, revision,
  publicacion y archivo, `reviewed_by` (SET NULL) y `like_count`. CHECKs:
  rechazado exige motivo; aprobado exige `published_at` (no `reviewed_by`, para
  que borrar a un jefe que aprobo posts no falle). Indices parciales para el
  feed general y por modelo, la cola de revision y la lista de la modelo.
- `post_media`: `kind` (`imagen|video`), `url`, `poster_url` (solo video),
  `mime_type` y `bytes` deducidos de los bytes, `width`/`height`, `duration_ms`
  informado por el navegador y no verificado, y `position` con
  `UNIQUE (post_id, position) DEFERRABLE INITIALLY DEFERRED`.
- `post_likes`: llave primaria `(post_id, client_id)`. El trigger
  `trg_post_likes_like_count` suma o resta `posts.like_count`; TypeORM no inserta
  ni actualiza esa columna.
- `posts/post-estados.ts`: `puedeTransicionar` (el paso a pendiente exige al
  menos una media), `siguienteAlEditar` (aprobado -> pendiente conservando
  likes, rechazado -> borrador, pendiente sigue pendiente), `esVisibleEnFeed` y
  los topes de media y caption.
- `UploadService`: `sniffVideoContentType` (MP4 y WebM por bytes; MOV solo con
  marca compatible), `uploadPostMedia` y `uploadPostPoster` a
  `posts/<employeeId>/<uuid>.<ext>` con `Cache-Control` inmutable.
- Los posts de jefe o admin encadenan borrador -> pendiente -> aprobado en una
  transaccion (B5); no hay transicion directa.

Pendiente:

- Ejecutar `migration:run`, `migration:revert` y `migration:run` contra una base
  real: trigger, cascada, UNIQUE diferido, CHECKs e indices.
- WebM se reconoce solo por la cabecera EBML: un Matroska que no sea WebM pasa
  como `video/webm`.

### Fase 3, F0 y F1 (base del frontend del feed y componentes)

- `lib/posts.ts` (probado en `lib/posts.spec.ts`): tipos del contrato
  (`PostDelFeed`, `PaginaDeFeed`, `EstadoMeGusta`), `rutaDelFeed`, `unirPaginas`
  (sin duplicados), me gusta como "confirmado + deseado" (un doble toque no cruza
  un PUT y un DELETE), textos en hora de Mexico y `REGLAS_DE_MEDIA` /
  `validarMediaLocal` / `ACEPTA_MEDIA` para el portal de la modelo.
- `Modelo.slug` desde `slugCatalogo`; `destinoSeguroDelCliente` admite `/feed` y
  `/modelos/<slug>`; middleware: `/feed` en la rama del cliente y `/modelos` solo
  renueva sesion (perfil publico).
- `components/feed/`: `TarjetaPost`, `BotonMeGusta`, `CarruselMedia` (scroll
  nativo con snap local, navegacion finita), `VideoPost` (sin autoplay,
  `preload="none"`, pausa fuera de pantalla) y `ListaPosts` ("Cargar mas").

Pendiente:

- F2: paginas `/feed` y `/modelos/[slug]` (sin sesion, ficha sin posts).
- Verificacion en navegador y contra backend real; los componentes no tienen
  pruebas por falta de `jest-environment-jsdom`.
- `slugCatalogo` no tiene formato validado en el backend (convendria
  `^[a-z0-9-]+$`).
- Sin texto alternativo por imagen ni subtitulos de video.
- `next.config.ts` debe admitir el dominio publico de R2 si no es `*.r2.dev`.
- Sin tope por imagen; decidir en F3 si se sube una media por peticion por el
  limite de 20 MB de Next.
- Carrusel sin vuelta al principio.

### Fase 2, paso 11 (panel del equipo en el chat web)

- `/jefe/chats-web` (hermana de "Hoy", que es la bandeja de Telegram; se cambia
  con `SelectorDeBandeja`) y `/admin/chats-web` (menu Operacion) con el mismo
  `BandejaChatsWeb`. Componentes en `components/jefe/chats-web/`.
- Bandeja con filtros por estado, busqueda, insignias de atencion en texto y
  quien tiene el control. Conversacion con historial paginado, etiquetas
  IA/Jefe/Cliente/Sistema, comprobante y foto en visor (`<dialog>` nativo),
  ubicacion con enlace al mapa.
- Tomar, devolver, aceptar y rechazar con `DialogoConfirmacion` (`<dialog>`
  nativo; rechazar pide motivo opcional). Barra de respuesta solo con el control;
  envio idempotente por `clientMessageId`.
- Logica pura probada en `lib/chats-del-equipo.ts` (`accionesDisponibles`,
  `queRecargar`, `traducirFalloDelEquipo`, `resumenDelBorrador`). `ApiError`
  guarda el cuerpo del error.
- Cliente: la cabecera sale de `GET /conversations/:id`; la subida de comprobante
  se rige por `comprobantePendiente`; `typing` con `activo: false` apaga el
  indicador.

Pendiente:

- Verificacion en navegador y contra un backend real (dialogos nativos en Safari
  e iOS, alturas en la app instalada, SSE de jefes con admin, 409 reales,
  aceptar y rechazar de punta a punta).
- Backend: falta leer el borrador (hoy el resumen sale del aviso "Solicitud lista
  para revision"), el nombre de quien tiene el control en la bandeja y
  `GET /staff/conversations/:id`.
- Los specs de `components/jefe/today` siguen sin ejecutarse por
  `jest-environment-jsdom`; `next build` sigue cayendo por `@playwright/test`.

### Fase 3, B4

API del feed para el cliente. Modulo nuevo `feed` (`FeedModule`, registrado en
`AppModule`), aparte de `PostsModule`.

- Rutas, todas `JwtAuthGuard` + `RolesGuard` + `@Roles('cliente')`:
  `GET /feed` y `GET /feed/models/:slug` (`?cursor=&limit=`, limit 1..20, 10 por
  defecto) devuelven `{ items, nextCursor }`; `PUT` y `DELETE
  /feed/posts/:id/like` (con `CsrfGuard`, 60/min) devuelven `{ liked, likeCount }`.
- La ficha sale de `Clientes.usuarioId` (sin ficha 404) y exige
  `mayor_de_edad_declarado_at` (sin ella 403), tambien para los likes.
- Solo posts `aprobado` de modelos visibles; lo demas responde 404.
- Paginacion por `(published_at, id)` descendente, comparada como tupla en SQL,
  pidiendo `limit + 1`. El cursor es base64url de `published_at|id` con la fecha
  en texto con microsegundos, para no perder posts del mismo milisegundo; mal
  formado responde 400.
- Una consulta por pagina: modelo por JOIN, `likedByMe` por EXISTS y media con
  `json_agg` ordenado por `position`.
- Likes idempotentes: visibilidad y mutacion en un CTE (`INSERT ... ON CONFLICT
  DO NOTHING` / `DELETE ... USING`) y `like_count` releido en otra sentencia,
  despues del trigger.
- Criterio de visibilidad de la modelo extraido a `employees/modelo-visible.ts`;
  `ConversationsService` delega en el sin cambiar su SQL ni sus specs.
- `GET /catalog/employees` no cambia ni expone posts.

Pendiente:

- Probar contra Postgres real la tupla del cursor y sus indices, el EXISTS, el
  `json_agg`, los CTE con `ON CONFLICT` / `DELETE ... USING` y la relectura del
  contador tras el trigger; probar las rutas de punta a punta.
- `EmployeesService.findAllActive` sigue aplicando el criterio de visibilidad en
  memoria: unificarlo con `modelo-visible.ts`.

### Fase 3, B3

API de la modelo para sus posts, desde el portal (`/employee-portal/posts`).

- `PostsService` (exportado para B5): `crearBorrador`, `editarCaption`,
  `agregarMedia`, `quitarMedia`, `reordenarMedia`, `enviar`, `borrar`,
  `listarDeLaModelo`, `obtener` y `modeloDelPost`. No conoce al actor: recibe la
  `employeeId` (obligatoria) y un post ajeno responde 404 como uno inexistente;
  el alcance lo decide quien llama.
- Toda transicion es un UPDATE condicionado al estado leido y comprobado con
  RETURNING (409 a quien pierde la carrera). Texto y media bloquean la fila del
  post (`FOR UPDATE`); `enviar` es un solo UPDATE que exige estado y media.
- Editar (texto o media) aplica `siguienteAlEditar`: un aprobado vuelve a
  pendiente con `submitted_at` nuevo y conserva likes y `published_at` (B5 debe
  aprobar con `COALESCE(published_at, now())`); un rechazado vuelve a borrador y
  conserva el motivo hasta reenviarse.
- `enviar` acepta borrador y rechazado (este como `rechazado -> borrador ->
  pendiente`, incluso sin cambios) y limpia el motivo de rechazo.
- Borrar: borrador y rechazado se borran con su media en R2; pendiente y
  aprobado se archivan (se anadio `pendiente -> archivado` a la maquina de
  estados); archivado es idempotente. La lista de la modelo no muestra archivados.
- Media: una por peticion (multipart `file`, `poster` obligatorio en video,
  `width`/`height`/`durationMs`); el tipo lo deciden los bytes. Topes comprobados
  antes de subir y otra vez con el post bloqueado; si el INSERT falla se borra de
  R2 lo subido. Reordenar es un UPDATE en transaccion con el UNIQUE de posicion
  diferido.
- `EmployeePostsController` con `PortalAuthGuard` y sin `RolesGuard`: la barrera
  de rol es `findByUserId` en cada ruta (404 si la cuenta no es de una empleada).

Contrato: `PostDeLaModelo = { id, caption, status, rejectionReason, submittedAt,
publishedAt, createdAt, likeCount, media: [{ id, kind, url, posterUrl, width,
height, durationMs, position }] }`. `GET /` (cursor uuid, limit 1-50),
`POST /` `{ caption }`, `PATCH /:id`, `POST /:id/media` (multipart), `DELETE
/:id/media/:mediaId`, `PUT /:id/media/order` `{ ids }`, `POST /:id/submit`,
`DELETE /:id`.

Pendiente:

- Probar contra Postgres real `FOR UPDATE`, `SET CONSTRAINTS` por nombre, el
  `unnest ... WITH ORDINALITY`, la cascada al borrar y los CHECKs.
- Multer aplica un solo `fileSize` (20 MB) a `file` y `poster`.

### Fase 3, F2 (paginas del feed y navegacion del cliente)

- `/feed` (noindex, `getCurrentUser`; sin sesion al login con `siguiente`,
  personal a su inicio): primera pagina en servidor con `lib/data/posts.ts`, que
  devuelve `LecturaDelFeed` (ok / sin-edad 403 / no-disponible 404 / error). El
  error de red llega a `ListaPosts` como `errorInicial`.
- `/modelos/[slug]`: perfil con forma de red social, ISR como el catalogo
  (`revalidate = 30`, `generateStaticParams`, `dynamicParams`). El render no lee
  cookies; la ficha sale de `getCatalogModelos` (slug inexistente -> 404). La
  sesion y los posts los resuelve `SesionDelPerfil` despues de montar con
  `publicacionesDelPerfilAction`: sin sesion, bloque para entrar o crear cuenta
  con regreso al perfil; personal, aviso de que es solo para clientes; cliente,
  `ListaPosts` del slug. El perfil se indexa (canonical, OG `profile`): el HTML
  solo lleva la ficha publica que el catalogo ya publica, nunca los posts.
- `FichaModelo` y `estadoDeContacto` extraidos de `ModelProfile`; el modal los
  reutiliza y enlaza "Ver perfil" si hay slug.
- `NavegacionCliente`: Publicaciones, Mis chats, Mi cuenta. Barra inferior fija
  en movil (area segura), franja sticky arriba desde `md`. En `/feed`, `/chats`,
  `/cuenta` y el perfil con sesion de cliente; no en `/chats/[id]`.
- El inicio del cliente pasa a `/feed` (`lib/roles.ts`).

Pendiente:

- Verificacion en navegador y contra el backend real (403/404 reales, barra en la
  app instalada, salto al llegar la sesion en el perfil).
- Backend: no hay forma de declarar los 18+ despues del registro (una cuenta
  antigua recibe 403 para siempre); el 404 de `GET /feed` no distingue "sin
  ficha" de otros; no hay lectura publica de una modelo por slug.
- `ListaPosts` muestra un 403 en paginas siguientes como error generico.
- Decision de producto: el perfil de la modelo se indexa en buscadores (solo la
  ficha publica). Revisar si se prefiere noindex.

### Fase 3, B5 y B6

API del equipo para los posts (`/staff/posts`) y avisos de revision.

- `StaffPostsController` y `StaffPostsService` en `PostsModule`. Todas las rutas
  con `JwtAuthGuard` + `RolesGuard` + `@Roles('admin','jefe')`; las que escriben,
  ademas `CsrfGuard` y limite de ritmo.
- Alcance compartido: `modelosAlAlcance` y `modeloAlAlcance` en
  `conversations/alcance-del-jefe.ts` (sin modulos de Nest, asi que `PostsModule`
  no depende de `ConversationsModule`). `StaffConversationsService` delega sin
  cambiar su SQL ni sus specs. Siempre se mira la modelo del post; fuera de
  alcance, 404.
- Cola: `GET /staff/posts` (`estado`, `employeeId`, `cursor`, `limit` 1..50).
  `pendiente` por `submitted_at` ascendente, los demas por `created_at`
  descendente. `GET /staff/posts/:id`.
- `approve` y `reject` (motivo obligatorio, 1..500) son UPDATE condicionados a
  `pendiente`: de dos jefes gana uno y el otro recibe 409. Aprobar usa
  `COALESCE(published_at, now())`. `archive` solo desde aprobado o pendiente.
- Publicar como el equipo: `POST /staff/posts`, `PATCH`, media (mismo multipart
  que la modelo), `DELETE` y `POST /:id/publish`, que en una transaccion encadena
  `borrador|rechazado -> pendiente -> aprobado` con la fila bloqueada, exige media
  y autor jefe/admin (un post de la modelo responde 409). Un aprobado editado
  vuelve a pendiente y se aprueba con `approve`.
- Avisos: `post_pending` a los jefes de la modelo al enviar y al editar un
  aprobado; `post_approved` / `post_rejected` a la modelo. Siempre despues del
  exito y sin lanzar. Llevan `eventId` porque el puente push deduplica por evento
  de forma permanente. Push con textos neutros; `post_pending` es apagable.

Contrato: `PostDelEquipo = { id, caption, status, rejectionReason, submittedAt,
reviewedAt, publishedAt, createdAt, likeCount, authorRole, employee: { id,
nombreArtistico, fotoPerfilUrl }, media: [{ id, kind, url, posterUrl, width,
height, durationMs, position }] }`. Lista `{ items, nextCursor }`.

Pendiente:

- Probar contra Postgres real el `json_agg`, la tupla del cursor, `status = $1`
  sobre el enum, `ANY($::uuid[])` y la cadena de dos UPDATE; probar las rutas de
  punta a punta.
- La URL del aviso `post_pending` es `/jefe/publicaciones`: la cola del jefe
  (F4) debe vivir ahi.
- La lista del jefe carga todas las modelos para calcular el alcance.

### Fase 3, F3

Portal de la modelo para sus publicaciones (`/empleada/posts`).

- Ruta con sesion propia (como el historial), enlace "Publicaciones" en la barra
  del portal y entrada en el `matcher` del middleware (solo renueva sesion).
- Logica pura probada en `lib/employee-posts.ts`: etiquetas de estado, acciones
  por estado, avisos de edicion de un publicado y de borrado (eliminar frente a
  archivar), traduccion de errores, limites previos a subir, portada y orden.
- Lecturas en `lib/data/employee-posts.ts` y acciones en
  `lib/actions/employee-posts.ts` (archivo propio con `apiFetch`).
- Media: una por Server Action, en serie, con estado por archivo, barra de
  "Subidos N de M", reintentar y descartar. Fotos comprimidas con `comprimirFoto`;
  videos validados en el navegador (duracion del metadato, peso), portada
  capturada en canvas y `width`/`height`/`durationMs` leidos del video. Video y
  portada tienen que caber juntos en 20 MiB.
- `next.config.ts`: `experimental.middlewareClientMaxBodySize: "20mb"`. El
  middleware cortaba en silencio a 10 MB el cuerpo de las rutas de su matcher, y
  la Server Action recibia el multipart truncado. Afecta a todo el matcher: una
  peticion grande puede ocupar hasta 20 MB de memoria.
- Se sube a 30/min el limite de `POST .../media` (modelo y equipo): con 10 por
  minuto, subir diez archivos y reintentar uno daba 429.
- UI en `components/empleada/posts/`: lista con miniaturas, estado, motivo y me
  gusta; el editor sustituye a la lista; orden con botones subir y bajar de 44 px;
  confirmacion previa al primer cambio de un publicado; `DialogoConfirmacion`
  movido a `components/ui` (el del chat web lo reexporta). El borrador se crea
  al guardar el texto o subir el primer archivo.

Pendiente:

- Verificacion en navegador y contra backend real: portada de video en iOS y
  Android, WebM con duracion `Infinity`, videos de 10 a 20 MB de punta a punta,
  413 y error de cuerpo de la Server Action, dialogos en Safari y app instalada.
- Un video de 20 MB exactos no cabe con su portada: el tope practico es de unos
  19,9 MB, hasta las URLs prefirmadas.
- Sin texto alternativo por foto. El dominio publico de R2 en `remotePatterns`
  sigue pendiente.
- Cancelar la confirmacion tras elegir archivos en un publicado no libera sus
  vistas previas hasta recargar.

### Fase 3, F4 (cola de publicaciones del equipo)

- `/jefe/publicaciones` (direccion del aviso `post_pending`) y
  `/admin/publicaciones` (menu Control) con el mismo `ColaDePublicaciones`.
  Componentes en `components/jefe/publicaciones/`.
- Navegacion del jefe: sin septima celda. La cola cuelga de "Hoy" como tercera
  entrada de `SelectorDeBandeja` (Telegram, Chats web, Publicaciones). Insignia
  de pendientes con texto accesible en "Hoy", leida al montar, al navegar (como
  mucho cada 30 s) y al volver a la app.
- Cola con filtros por estado (Por revisar por defecto, del mas antiguo al mas
  nuevo; Rechazadas, Publicadas, Archivadas), por modelo y "Cargar mas".
- Revision con todas las medias a tamano util: fotos ampliables, video con
  controles nativos, sin autoplay y `preload="metadata"` para comparar la
  duracion real con la declarada. Aviso "Edicion de una publicacion ya aprobada;
  conserva sus likes".
- Aprobar no se deshabilita: si falta revisar alguna media, lo dice y lleva el
  foco a ella. Foto revisada = cargada y a la vista (60 %) o abierta; video visto
  = `video.played` cubre el 90 %. Aprobar, rechazar (motivo obligatorio, 1..500)
  y archivar con `DialogoConfirmacion`. 409 y 404 releen la cola con aviso.
- Tiempo real: `post_pending` relee la cola (400 ms), al reconectar y al volver.

Pendiente:

- Verificacion en navegador y contra un backend real.
- Backend: no hay conteo de pendientes (la insignia pide 20 y dice "20+"), ni
  lista de modelos al alcance del jefe, ni `bytes`/`mimeType` en la media (sin
  peso del video), ni evento al equipo cuando otro jefe decide un post.
- Lo revisado de cada post vive en memoria.
- Publicar como jefe (`POST /staff/posts`, media, `/publish`) queda para un paso
  posterior.

## Fase 5: personal sin Telegram (plan y decisiones)

Objetivo: que ningun rol (admin, jefe, empleada, chofer, candidata) necesite
Telegram para entrar, operar ni enterarse de nada. Estrategia: reemplazar la
funcion y despues borrar; no se porta ningun handler de Telegram. Al terminar,
`telegram/` y `telegram-conversations/` quedan sin consumidores fuera de sus
carpetas (salvo columnas y entidades) y la Fase 6 es solo borrar.

### Decisiones tomadas (recomendaciones del planificador)

1. Sin proveedor de correo, el restablecimiento de contrasena lo hace el admin
   (o el jefe sobre su equipo) con contrasena temporal y cambio forzado en el
   primer acceso. El flujo por correo llega cuando haya proveedor.
2. Un solo login para todos los roles: `/ingresar`. `/admin` sin sesion
   redirige ahi.
3. Fotos semanales: al quitar el filtro por `telegramChatId`, todas las modelos
   pasan a estar sujetas a la multa; se da una semana de gracia sin multa.
4. `modo_bot` se retira del reparto de choferes y del aviso a la empleada: todos
   usan la plataforma.
5. Se conservan los dos sistemas de reporte (`conduct_reports` y
   `employee_reports`) y se da entrada web al segundo desde el chat del cliente y
   el portal del chofer.
6. Servicio grupal del cliente web: el jefe elige las modelos en `/jefe/grupos`;
   el cliente conversa, ve la cotizacion y manda el comprobante.
7. Recordatorio del reglamento: push a las 3 h y despues una vez al dia, con
   tope.
8. El reglamento no bloquea nada (solo fija trust score y orden de candidatas).
9. Reparto de choferes: se ignoran ubicaciones con mas de 15 minutos de
   antiguedad y el jefe ve cuando la ubicacion esta vieja.

### No se porta (aprobado por recomendacion)

Comandos de admin sobre clientes de Telegram (`/pausarbot`, `/enviar`,
`/chats`, espia...), grupo del jefe con temas, enrutado de la IA hacia el jefe
por Telegram y su infraestructura (guardia de callbacks, cola de envio),
`/panel`, `/portal` y deep links, fotos exclusivas para clientes (diferidas),
trio y "otras modelos / modelo ocupada", wizards de servicio manual por botones,
alerta de sentimiento (solo si se porta la calificacion del cliente con
comentario), y los schedulers de borrado de mensajes y mantenimiento de sesion.

### Etapas

- Etapa 1 (secuencial): B-acceso (cambio de contrasena propio, restablecimiento
  por admin con contrasena temporal, `debe_cambiar_password`) y F-acceso (un
  solo login, portales sin token redirigen al login, cambio forzado).
- Etapa 2 (carriles en paralelo, archivos disjuntos): B-onboarding (reglamento y
  cuestionario web), B-candidatas (evaluacion publica por token), B-chofer
  (disponibilidad y frescura de ubicacion), B-calificaciones-cliente
  (calificar, reportar y volver a contratar desde el chat; choferes por
  calificar), B-schedulers (weekly-content, challenges, recordatorios sin
  Telegram), B-grupos (G1-G5) y B-emisores (quitar ~55 envios de
  `services.service.ts` y los de `driver-trips`, con su gemelo web).
- Etapa 3 (secuencial): B-portales (`JwtAuthGuard` + roles en lugar de
  `PortalAuthGuard`, borrar `portal-session`, canje de token y
  `Telegram.WebApp`), B-panel-access (borrar pases), limpieza de bandejas de
  Telegram, mover `CustomerBookingSession` a `booking/entities/`, prueba de
  aceptacion con Telegram desactivado.

Metrica de avance (debe bajar a cero fuera de las carpetas de Telegram):
`rg -l "telegram.service|telegram.module|InjectBot|telegram-link-code|telegram-portal-buttons" backend/src --glob '!backend/src/telegram/**' --glob '!backend/src/telegram-conversations/**' --glob '!**/*.spec.ts'`

### Fase 4 (frontend)

- `/cuenta` pasa a ser el perfil del cliente (la ruta no cambia: middleware,
  destinos del login y verificacion del correo ya llevan ahi). La barra
  `NavegacionCliente` y el titulo dicen "Mi perfil".
- Lectura con `lib/data/perfil-cliente.ts` (`GET /client-accounts/me/perfil`)
  envuelta en `optionalSource`: un fallo de red deja aviso y `BotonReintentar`;
  un 401 se reemite y manda a `/ingresar`.
- Secciones: estado (`TarjetaEstado`; restringida en dorado oscuro, con texto
  generico), calificacion (`TarjetaCalificacion`: "4,5" de 5 y "N
  calificaciones"; sin promedio, "Aun sin calificacion suficiente" y nunca una
  estrella vacia ni un cero), nivel (`TarjetaNivel`, sin beneficios ni
  progreso), servicios completados y "Miembro desde" en hora de Mexico.
- `FormNombre` y `FormContrasena` (`current-password` / `new-password`,
  mostrar/ocultar con `aria-pressed`, campos vaciados tras el exito con aviso de
  que se cerraron las otras sesiones). Exito en `role="status"`, error en
  `role="alert"`.

Pendiente:

- Verificacion en navegador y contra el backend real.
- El backend distingue los dos 400 del cambio de contrasena solo por el texto;
  conviene un `code` estable.
- Definir que limita una cuenta `restringida` y a que canal remitir.
- No hay recuperacion de contrasena olvidada (depende del proveedor de correo).

### Fase 4 (backend)

Perfil del cliente, edicion de nombre y cambio de contrasena, en
`ClientAccountsModule`.

- Rutas, todas `JwtAuthGuard` + `RolesGuard` + `@Roles('cliente')`:
  `GET /client-accounts/me/perfil` devuelve `{ nombre, email, correoVerificado,
  miembroDesde, servicios, calificacion: { promedio, cantidad }, nivel: { codigo,
  nombre }, estado: 'activa'|'restringida' }`, lista cerrada copiada campo por
  campo; sin ficha 404. `PATCH /client-accounts/me` (`CsrfGuard`, 10/min)
  recibe `{ nombre }` 1..255 y responde `{ nombre }`. `POST
  /client-accounts/me/password` (`CsrfGuard`, 5/min) recibe `{ actual, nueva }` y
  responde 204; una actual incorrecta (o cuenta inexistente, comparada contra un
  hash de relleno) responde 400 generico; una nueva igual a la actual, 400.
- Calificacion recibida: mismo criterio que `DisciplineService.ratingSummary`
  (`employee_to_client`, sin `pending` ni `overturned`); con menos de
  `MINIMO_DE_CALIFICACIONES = 3` el promedio es `null` y la cantidad se devuelve
  igual. No se expone comentario, quien califico ni ids.
- Estado: `restringida` si hay una suspension o expulsion vigente del cliente,
  leida por SQL directo en `disciplinary_sanctions`. No se inyecta
  `DisciplineService`: cerraria un ciclo de modulos y su `getActiveSanction`
  escribe. Nunca se expone motivo, tipo ni fechas.
- Nivel: `calcularNivel` en `nivel-del-cliente.service.ts`, fija en `inicial`
  hasta que el dueno defina los niveles; es el unico lugar que debe cambiar. No
  usa `LoyaltyTier` ni `ClientMembership`. Sin migracion.
- Cambio de contrasena: hash nuevo y revocacion de las demas `AuthSession` del
  usuario en una transaccion; se conserva la familia de la sesion actual, no solo
  su `sid`, para no revocar la sesion que nace de una renovacion cruzada.
- `@SesionActual()` (`auth/decorators/sesion-actual.decorator.ts`) relee el access
  token con el mismo extractor que `JwtStrategy` (ahora exportado como
  `extraerAccessToken`) y lo decodifica; solo es seguro detras de `JwtAuthGuard`.

Pendiente:

- Probar contra Postgres real las consultas de calificacion, servicios y
  sancion y el UPDATE de revocacion; probar las rutas de punta a punta.
- Definir con el dueno los niveles del cliente y cambiar solo `calcularNivel`.

### Fase 5, B-acceso (backend)

- Migracion `1811003000000-AddMustChangePassword`: `usuarios.debe_cambiar_password
  boolean NOT NULL DEFAULT false` (idempotente, con `down`).
- `CuentaDelPersonalService` con tres rutas en `UsersController`, todas con
  `JwtAuthGuard + RolesGuard + CsrfGuard` y `@Throttle`:
  - `PATCH /users/me/password` (admin, jefe, empleada, chofer; 5/min):
    `{ actual, nueva }`, nueva 8..72 con letra y numero y distinta de la actual;
    204. Quita la marca y revoca las demas sesiones conservando la actual y su
    familia.
  - `PATCH /users/me` (10/min): `{ nombre?, apellido?, telefono? }`, lista
    cerrada (un campo extra da 400). Email, rol y `activo` siguen siendo del
    admin.
  - `POST /users/:id/reset-password` (admin, jefe; 10/min): genera una temporal
    de 14 caracteres (`crypto.randomInt`, sin caracteres ambiguos), guarda solo
    el hash, pone la marca, revoca todas las sesiones del objetivo y devuelve
    `{ passwordTemporal }` una sola vez (nunca en logs). Alcance: admin sobre
    todo el personal salvo si mismo y los clientes; jefe solo sobre modelos con
    `jefeId`/`jefeSecundarioId` = el; jefe sobre jefe o admin 403; jefe sobre
    chofer 404 (no hay relacion chofer-jefe: solo el admin); cuenta desactivada
    409.
- Alta de personal (`UsersService.create`, `EmployeesService.create`,
  `DriversService.create`) marca `debe_cambiar_password = true`; el admin
  sembrado no.
- `GET /auth/me` y `{ user }` de login, refresh, register, panel-access y
  portal-session incluyen `debeCambiarPassword`. La marca es UX: el backend no
  bloquea la API; la proteccion real es que la temporal se entrega una vez y las
  sesiones previas se revocan.
- Cierre de un hueco: `PATCH /users/:id` aceptaba `password` y dejaba a un jefe
  cambiar la clave de cualquier cuenta que no fuera admin sin alcance, sin marca
  y sin revocar sesiones. Ahora solo un admin puede, y marca el cambio forzado
  (salvo sobre su propia cuenta).

Pendiente:

- Migracion sin probar contra Postgres real.
- `PATCH /users/:id` de un admin que cambia la clave de otro no revoca las
  sesiones de esa persona (el restablecimiento si).

### Fase 5, F-acceso (frontend)

- `/ingresar` es el unico login; `LoginForm` de admin se borra y `/admin` sin
  sesion redirige ahi. El middleware y `lib/roles.ts` reparten destinos por rol.
- `/cambiar-contrasena` (cambio forzado) y `SeccionSeguridad` en los ajustes de
  cada rol; `RestablecerContrasena` entrega la temporal una sola vez.
- Acciones en `lib/actions/acceso-personal.ts`.

Pendiente:

- Portales sin token redirigen al login (Etapa 3, B-portales).
- Probar el flujo completo contra backend y Postgres reales.

### Fase 5, B-onboarding

Reglamento y cuestionario del personal (empleada, chofer, jefe) por web, en
`EmployeeOnboardingModule`. No se porta ningun handler de Telegram; el flujo de
Telegram sigue intacto hasta la Fase 6.

- `ReglamentoWebController` (`staff-onboarding/me`), `JwtAuthGuard + RolesGuard +
  CsrfGuard`, `@Roles('empleada', 'chofer', 'jefe')`:
  - `GET /staff-onboarding/me`: `{ reglamento: { titulo, contenido,
    publicadoEn, puntajeMinimo } | null, cuestionario: { estado, esRenovacion,
    intentos, mejorPuntaje, aprobadoEn, pregunta } | null }`. Sin reglamento
    publicado para el rol responde vacio (no 404). Si la persona no tenia
    asignacion se crea aqui (`ensureCurrentAssignmentForUser`).
  - `POST /staff-onboarding/me/questionnaire` (10/min): empieza o retoma el
    intento abierto; devuelve `{ completado: false, pregunta }`.
  - `POST /staff-onboarding/me/questionnaire/answers` (30/min): `{ opcionId }`
    (uuid). Devuelve la siguiente pregunta o `{ completado: true, aprobado,
    puntaje, mejorPuntaje, puntajeMinimo, correctas, total, intentos }`.
  - La pregunta sale como `{ id, texto, numero, total, opciones: [{ id, texto
    }] }`: sin `isCorrect` y sin trust score en ninguna respuesta (el trust
    score ordena candidatas y es para quien asigna).
- La logica de intentos, variantes por casilla, puntaje y trust score sigue en
  `EmployeeOnboardingService`; `ReglamentoWebService` solo decide que se muestra
  (`getNextQuestion` paso a ser publico para eso).
- Recordatorio (decision 7): `ReglamentoRecordatoriosScheduler`, con clave propia
  `ADVISORY_LOCKS.onboardingWebReminders` (811_021; compartir la de Telegram
  haria que uno de los dos ciclos se saltara siempre el turno). Corre sin
  depender del token del bot. En cada ciclo:
  1. Crea la asignacion al personal activo sin asignacion cuyo rol ya tiene
     reglamento (antes nacia al vincular Telegram).
  2. Push a las `ONBOARDING_REMINDER_HOURS` (3 h) de `assigned_at` y despues uno
     cada 24 h mientras no este aprobado (incluye intento a medias y
     reprobado), hasta `MAXIMO_DE_RECORDATORIOS = 7`. Clave de dedupe
     `onboarding:recordatorio:<asignacion>:<n>`; se avisa y despues se cuenta.
     Se cuenta aunque la persona no tenga dispositivos.
  3. El texto del push no lleva contenido ni puntajes. Destino por rol:
     `/empleada/portal`, `/chofer/portal`, `/jefe` (`DESTINO_POR_ROL`).
- No bloquea nada (decision 8): ninguna ruta ni guardia consulta el estado del
  cuestionario.
- Migracion `1811004100000-AddOnboardingWebReminders`:
  `employee_onboardings.web_reminder_count smallint NOT NULL DEFAULT 0` y
  `last_web_reminder_at timestamptz NULL`, idempotente y con `down`. No reutiliza
  `reminder_sent_at` para que los dos canales no se apaguen entre si.

Pendiente:

- Migracion y consultas (`asignarAlPersonalSinReglamento`,
  `recordatoriosPendientes`) sin probar contra Postgres real.
- Confirmar con el dueno el tope de 7 recordatorios y si deben respetar un
  horario (hoy el diario sale a la hora en que se asigno, tambien de madrugada).
- Al desplegar, las asignaciones antiguas sin aprobar empiezan a recibir
  recordatorios web desde el primer ciclo.
- Frontend: vista del reglamento y del cuestionario; cuando exista su ruta,
  cambiar solo `DESTINO_POR_ROL`.
- Los recordatorios no se pueden silenciar desde ajustes (sin `tipo`); si se
  quiere, registrar el tipo en `avisos-catalogo.ts`.
- Fase 6: borrar `telegram-onboarding.*`, `findPendingDeliveries`,
  `findDueReminders`, `markWelcomeSent/RegulationSent/ReminderSent` y las
  columnas `welcome_sent_at`, `regulation_sent_at`, `reminder_sent_at`.

### Fase 5, B-chofer (backend)

Decisiones 4 y 9: `modo_bot` fuera del reparto y del aviso a la empleada, y
ubicaciones de mas de 15 minutos ignoradas en el reparto.

- `drivers/ubicacion-fresca.ts`: `MINUTOS_DE_UBICACION_FRESCA = 15` y
  `sqlUbicacionFresca(alias)`, la condicion unica (`ultima_ubicacion_at` no nula
  y `>= now() - interval '15 minutes'`, con el reloj de PostgreSQL). Una marca
  nula cuenta como vieja: es la posicion tecleada a mano en el alta o la
  edicion, que no actualiza `ultima_ubicacion_at`. La aplican el reparto, su
  diagnostico, `findAvailableDriversOrderByDistance` y la ficha del jefe.
- `ServicesService.dispatchViaje`: quita `chofer.modo_bot = true` y exige
  `sqlUbicacionFresca('chofer')`. Haversine sigue en PostgreSQL
  (`calcular_distancia_haversine`).
- `ServicesService.aceptar`: se borra el conteo previo de choferes con
  `modo_bot` que mandaba el viaje solo a Uber. Ahora siempre se despacha; sin
  chofer elegible, `notifyNoDriversAvailable` avisa al jefe, que decide si lo
  cambia a Uber. El aviso de Telegram a la empleada ya no mira `modoBot`.
- `diagnostico-de-reparto.ts`: deja de contar "con Telegram vinculado" (el
  reparto ya no lo exigia y el diagnostico culpaba a un chat sin vincular) y
  anade el escalon "con ubicacion de los ultimos 15 minutos", con su linea
  propia cuando es ahi donde cae a cero.
- `GET /drivers` y `GET /drivers/:id` devuelven `ubicacionVieja: boolean`
  (campo calculado, no columna, como `sancionada`): true si falta la posicion o
  el reparto la ignora. Lo decide PostgreSQL con la misma condicion. Junto con
  `ultimaUbicacionAt`, que ya salia, es lo que el jefe necesita.
- Sin migracion: `ultima_ubicacion_at` ya existia y `LocationsService` la
  escribe al menos una vez por minuto mientras el portal manda posicion.
- Pruebas: `ubicacion-fresca.spec.ts`, `diagnostico-de-reparto.spec.ts`,
  `drivers.service.ubicacion.spec.ts`, `services.reparto-choferes.spec.ts`; el
  doble de `choferesRepository` en `services.accept-concurrency.spec.ts` queda
  vacio para probar que aceptar ya no consulta choferes.

Pendiente:

- Frontend: mostrar `ubicacionVieja` (y la antiguedad desde
  `ultimaUbicacionAt`) en `/admin/drivers`, el mapa y la ficha; anadir el campo
  a `Driver` en `catalogo-cs/lib/types.ts`. El toggle de `modo_bot`
  (`lib/actions/modo-bot.ts`) ya no tiene efecto en el reparto.
- El expediente del chofer en `god-eye.service.ts` no expone
  `ultima_ubicacion_at` ni la marca; quedo fuera por ser archivo compartido.
- La ubicacion de la empleada (punto de recogida del viaje de ida) no tiene
  limite de antiguedad; la decision 9 habla solo de choferes.
- Probar contra Postgres real la consulta del reparto y la del diagnostico.
- Fase 6: borrar la columna `modo_bot` de `choferes` y `empleadas`, sus campos
  en los DTO de alta y el toggle del panel.

### Fase 5, B-schedulers

Contenido semanal, retos y recordatorio de cita sin Telegram. Los avisos salen
por `NotificationsService.notificar` (push) con `dedupeKey`, asi que un
guardado que falle tras avisar no duplica el aviso en la pasada siguiente. Los
tres ciclos siguen bajo su `withAdvisoryLock` (`weeklyContent`, `challenges`,
`serviceSchedule`); no hizo falta clave nueva.

- Fotos semanales (decision 3): `WeeklyContentScheduler` ya no filtra por
  `telegramChatId`; pide fotos a toda modelo con `catalogoActivo`. Ni el
  scheduler ni el de retos se apagan sin token del bot.
- Semana de gracia: `WeeklyContentService.esSemanaDeGracia` es verdadera cuando
  la modelo no tiene ningun `weekly_content_schedules` anterior al ciclo. Se
  deriva de la historia, sin migracion. Quien ya estaba sujeta (tenia Telegram)
  tiene ciclos previos y no la recibe; quien entra por primera vez, incluida una
  modelo nueva, si. En gracia el recordatorio dice que no hay multa y al agotar
  los avisos el ciclo se cierra en `falta_aplicada` sin multa, sin registro de
  corte y sin reporte de conducta, con un aviso que lo explica.
  `getWeeklyStatusForEmployee` devuelve `semanaDeGracia`.
- Avisos de fotos: pedido del viernes, recordatorios ("N de M") y rechazo con
  motivo (recortado a 120 caracteres) con tipo `fotos_semanales`; la multa con
  tipo `sancion`. Todos llevan a `/empleada/portal?seccion=fotos`. Se retiraron
  `TelegramService`, `PanelAccessService` y `botonesDePortal` del modulo.
- Retos: `ChallengesService` avisa por push al `usuario_id` de cada participante
  (empleada o chofer) al empezar y al terminar (su lugar y el ganador), con
  tipo nuevo `retos` en `avisos-catalogo.ts` (apagable por empleada y chofer).
  `ChallengesModule` importa `NotificationsModule` en lugar de `TelegramModule`.
- Recordatorio de cita (`ServiceScheduleScheduler`, 45 min antes): corre
  siempre; la modelo recibe push hacia `/empleada/servicio` y el jefe hacia
  `/jefe`. Se retiraron el mensaje directo a la modelo y el del grupo del jefe
  con botones `sched_trans` (el grupo con temas no se porta). El texto no lleva
  nombres ni hora.

Pendiente:

- Frontend: mostrar `semanaDeGracia` en la seccion de fotos del portal (hoy
  muestra el importe de la multa aunque esa semana no se cobre).
- `ServiceScheduleScheduler` conserva `@InjectBot` solo para el recordatorio al
  cliente de Telegram (la Fase 5 es del personal); se borra en la Fase 6. Sigue
  contando en la metrica de avance.
- `TelegramAdminUpdate` conserva el handler `sched_trans`, ya sin emisor.
- Los portales de empleada y chofer no tienen seccion de retos: el aviso abre
  el portal sin mas.
- Probar contra Postgres real el `count` con `LessThan` sobre `semana_inicio`
  (`date`) y el ciclo completo de un viernes a un martes.

### Fase 5, B-calificaciones-cliente

Modulo nuevo `ServiceFeedbackModule` (`backend/src/service-feedback/`), sin
migracion. No hay reglas nuevas: cada accion entra por el mismo metodo que el
bot (`createClientRatingIdempotent`, `addClientRatingReason`,
`EmployeeReportsService`), asi que ventana de 24 h, propiedad del servicio,
indice unico de reportes y efectos disciplinarios no pueden divergir.

- Cliente (`ClientServiceFeedbackController`, todo `JwtAuthGuard` + `RolesGuard`
  + `@Roles('cliente')`; las mutaciones con `CsrfGuard` y `@Throttle`):
  - `GET /client-feedback/pending?empleadaId=`: servicios finalizados en las
    ultimas 24 h, agrupados por servicio, con `modelos[{ id, nombreArtistico,
    estrellas|null }]` (en un grupal, cada participante no cancelada) y
    `categoriasReportadas`. Tope de 20 servicios.
  - `POST /client-feedback/services/:serviceId/rating` (10/min): `{ estrellas,
    empleadaId?, motivo?, comentario? }`. 201 si la crea, 200 si ya existia
    (devuelve la primera). Una calificacion baja no exige comentario, como en
    el bot; el motivo se guarda como comentario si no hay uno, y llegado despues
    se anade con `addClientRatingReason` (no en grupales). Copia las estrellas a
    `servicios.calificacion` solo si esta vacia y es la modelo principal.
  - `POST /client-feedback/services/:serviceId/report` (5/min): `{ categoria,
    descripcion }` a `employee_reports` con `origin = 'cliente'` y la misma
    `reporter_key` que el bot. Devuelve solo `{ id, categoria, creadoEn }`.
  - `POST /client-feedback/services/:serviceId/rehire` (10/min): el chat de un
    servicio aceptado queda `con_servicio` y la IA ya no contesta, asi que se
    cierra (solo si sigue colgado de ese servicio) con aviso
    `conversation_status_changed` al cliente, y se abre otro con la misma
    modelo via `openWithEmployee` (201/200, `ResumenDeConversacion`). Si ya
    habia otro chat abierto con ella, se devuelve ese. Servicio ajeno 404, sin
    terminar 409.
- Personal (`PortalServiceFeedbackController`, ya con sesion web y rol, no con
  `PortalAuthGuard`; mismo prefijo que cada portal):
  - `GET /employee-portal/ratings/pending-drivers` (`empleada`): choferes por
    calificar, `DisciplineService.listarChoferesPorCalificar`, viajes
    finalizados de sus servicios en las ultimas 24 h sin calificacion
    `employee_to_driver` suya. Se califica con el `POST
    /employee-portal/ratings` que ya existia.
  - `POST /driver-portal/employee-reports` (`chofer`, CSRF, 5/min): `{ viajeId,
    categoria, descripcion }` a `employee_reports` con `origin = 'chofer'`.
- `EmployeeReportsService`: `createFromClientAccount` (ficha por `usuarioId`) y
  `createFromDriverAccount` (por viaje propio y finalizado); la logica del
  cliente se comparte con la via de Telegram.

Pendiente:

- Frontend: tarjeta de valoracion en `/chats/[id]` (estrellas, motivo,
  reportar, volver a contratar), lista de choferes por calificar en el portal
  de la modelo y formulario de reporte en el portal del chofer. Las rutas de
  portal nuevas piden cookie de sesion: no funcionan con el token por query.
- `ServicesService.sendPostServiceSurvey` sigue mandando la encuesta solo por
  Telegram; falta el aviso web que invite a valorar (carril B-emisores).
- `listarClientesPorCalificar` y `listarEmpleadasPorCalificar` ofrecen 7 dias,
  pero calificar solo se admite 24 h: ofrecen servicios que el servidor
  rechaza. La lista nueva usa 24 h.
- El reporte de un grupal apunta siempre a la modelo principal del servicio.
- Cerrar el chat al volver a contratar no avisa a los jefes por SSE; su
  bandeja lo ve al recargar.
- Probar contra Postgres real la consulta de pendientes (LATERAL con `UNION`,
  `array_agg` de categorias) y el `UPDATE` de cierre de la conversacion.

### Fase 5, B-candidatas

Evaluacion de candidatas por web, sin Telegram ni sesion, sobre el
`CandidateScreeningModule` que ya existia (banco de preguntas, evaluaciones con
token, respuestas y alta en catalogo). Sin migracion: el token aleatorio de
`candidate_screenings` (72 bits, base64url, indice unico) ya era la credencial
del enlace de Telegram y pasa a serlo del enlace web. El flujo de Telegram sigue
intacto hasta la Fase 6.

- `CandidateScreeningPublicController` (`candidate-screening/public`), publico a
  proposito: sin `JwtAuthGuard`, `RolesGuard`, `@Roles` ni `CsrfGuard` (la
  candidata no tiene cuenta y un sitio ajeno no tiene el token). `@Throttle`
  60/min en las dos rutas, holgado porque el trafico anonimo llega por el proxy
  de Next y el throttler lo cuenta casi todo junto.
  - `GET /candidate-screening/public/:token`: `{ nombre, estado, pregunta: { id,
    texto, numero, total, opciones: [{ indice, texto }] } | null }`. Opciones
    vacias = respuesta escrita. Lista cerrada: nunca `isCorrect`, telefono,
    token ni quien la creo. Es lectura pura: no marca inicio, porque la vista
    previa del enlace en mensajeria hace un GET. Completada devuelve `pregunta:
    null` (el enlace no admite mas respuestas: es de un solo uso en ese
    sentido). Token con forma imposible o inexistente: el mismo 404.
  - `POST /candidate-screening/public/:token/answers` (200): `{ preguntaId,
    opcion? | texto? }`. `preguntaId` debe ser la pregunta pendiente; si no, 409
    (un doble envio no se guarda como respuesta de la pregunta siguiente). Con
    opciones exige `opcion` en rango y guarda su texto, como el bot; sin
    opciones exige `texto` de 2 a 4000. La primera respuesta pasa `pendiente` a
    `en_progreso` (condicionado, no pisa el inicio de Telegram). Devuelve `{
    completado: false, pregunta }` o `{ completado: true }`, sin puntaje.
- `registrarRespuesta` es comun a Telegram y web: el indice unico (evaluacion,
  pregunta) resuelve dos envios simultaneos con 409, y el cierre es un `UPDATE
  ... WHERE status <> 'completado'`, de modo que solo quien la cierra avisa.
- Resultado para quien decide: al completarse se mantiene el evento SSE
  `candidate_screening.completed` a `jefes` y se anade push a cada admin activo
  hacia `/admin/candidatas/:id`, sin el nombre de la candidata (pantalla de
  bloqueo), con `dedupeKey` `candidate_screening:completed:<id>`. Solo admins:
  `/admin/candidatas` y el controller de gestion siguen siendo `@Roles('admin')`.
- Decision 8: el reglamento del personal y su trust score no se mezclan con
  esta evaluacion; aqui no hay puntaje ni bloqueo.
- Pruebas: `candidate-screening.service.spec.ts`.

Pendiente:

- Frontend: pagina publica `/candidata/[token]` (o la ruta que se elija) fuera
  de las rutas protegidas del middleware, y en `CandidatasClient` cambiar
  `getCandidateScreeningTelegramUrl` por el enlace web (y el texto "por
  Telegram" del modal y del detalle).
- Confirmar con el dueno: si el jefe debe ver o gestionar candidatas (hoy solo
  admin); si los enlaces deben caducar (no hay columna de expiracion; el texto
  del bot ya dice "o ya expiro" sin que exista); si se quiere un puntaje de
  aciertos en preguntas con opciones (pediria guardar `is_correct` por
  respuesta, porque el banco se puede editar despues).
- `deleteQuestion` borra la pregunta del banco aunque una evaluacion abierta la
  tenga en su lista: `getNextQuestion` responde 404 y la candidata queda
  atascada, por web y por Telegram. Conviene desactivar en lugar de borrar o
  saltar las que falten.
- Con el token en la ruta, queda en los registros de acceso del proxy.
- Alta tras evaluar: `CandidateDetailClient` sigue pasando `telegramChatId` al
  registrar; sin Telegram queda vacio, sin efecto.
- Fase 6: borrar `bindTelegram`, `telegram_chat_id` de `candidate_screenings`,
  `onCandidateScreening*` de `telegram-auth.update.ts` y el payload
  `candidata_` de `telegram-start-payload.ts`.

### Fase 5, B-emisores

Envios de Telegram al personal (jefe, admin, modelo, chofer) fuera de
`services.service.ts` y `drivers/driver-trips.service.ts`. Cada uno se borro y,
si no tenia ya gemelo, se le dio uno por push (`NotificationsService.notificar`,
con `dedupeKey`). Los textos del push no llevan nombres, placas, notas ni
importes: salen en la pantalla de bloqueo. Sin migracion.

Regla aplicada: solo se quitan los envios al personal. Los del cliente que
todavia reserva por Telegram se conservan, igual que en B-schedulers, porque
la Fase 5 es del personal y ese canal se borra en la Fase 6.

- Medida (metrica de avance, `rg -l` de la seccion de la Fase 5): 17 archivos
  antes y 17 despues. Los dos archivos siguen contando porque conservan los
  envios al cliente (`@InjectBot` en `ServicesService`, `TelegramService` en
  `DriverTripsService`). Llamadas a la API de Telegram: `services.service.ts`
  de 61 a 16 (15 al cliente y el `getFileLink` de la captura que el jefe sube
  por el chat); `driver-trips.service.ts` de 8 a 2 (las dos al cliente).
- `ServicesService` ya no inyecta `TelegramService`.
- Gemelo que ya existia (solo se borro el Telegram): servicio pendiente al jefe
  (`notificarJefeServicioPendiente`), asignacion y recordatorio de aceptacion a
  la modelo, aceptacion y cita agendada (`new_service` del puente y
  `avisarEmpleadaDeServicio`), panico, sin choferes, cancelacion a modelo y
  chofer, regreso elegido (`return_transport_selected`), transporte externo
  asignado, aviso de extension, prorroga al chofer, oferta de viaje, captura
  del Uber, calificar al cliente, chofer en camino y chofer llegado.
- Push nuevo:
  - Chofer: racha de rechazos y multa (`tipo: sancion`, clave por viaje o por
    sancion); calificar a la pasajera al terminar un viaje
    (`ratings/pending-employees`).
  - Modelo: cancelacion por demora; servicio encadenado iniciado en el mismo
    sitio (`notifyScheduledServiceStarted`) o listo con transporte; viaje
    cambiado a Uber; Uber en camino y Uber llegado (marcados por el jefe);
    llegada al destino de la ida; monto definitivo; calificar al chofer
    (`ratings/pending-drivers`).
  - Jefe: regreso pendiente a los tres jefes posibles (el del servicio, el
    principal y el secundario de la modelo), con clave por momento
    (`adelantado`, `finalizado`, `recordatorio-N`); pedir el Uber del
    servicio encadenado.
- Corregido de paso: el evento en vivo `uber_en_route` / `uber_arrived` a la
  modelo solo salia si tenia Telegram.
- `no_drivers_available` lleva ahora `motivo` en `data`: antes el motivo solo
  salia en el tema del grupo.
- `saveUberScreenshotFromDashboard` ya no exige que la modelo tenga Telegram
  (devolvia 409) ni le reenvia la foto; responde `{ imageUrl }` (el frontend
  no leia `fileId`).
- Borrado por "No se porta" (grupo del jefe con temas): mensajes al tema,
  `deleteForumTopic` al rechazar y al cerrar, `cerrarTemaDelServicio`,
  `avisarAlJefe` del chofer, `retirarAvisosDeCamino`,
  `cambiarBotonesDeLaEmpleada`. El aviso de tres recordatorios de regreso a
  todos los jefes y admins por Telegram queda en el push al jefe del servicio
  y, para los admins, en el del puente.
- Sin cambios: el reparto de choferes (consulta, frescura, turnos, sanciones),
  `aceptar`/`rechazar` con jefe o admin y el relevo de jefe en `create`.
- Pruebas: `services.avisos-personal.spec.ts` (nueva) y ajustes en las de
  prorroga, cancelacion, empleada lista, transporte, aviso de extension,
  rechazo de oferta y `driver-trips.service.spec.ts`.

Pendiente:

- Envios al cliente de Telegram en estos dos archivos y `TelegramSession` /
  `parseSessionKey` (clientes que esperan a una modelo): Fase 6.
- `ServicesModule` y `DriversModule` siguen importando `TelegramModule` (el
  primero por `@InjectBot`, el segundo por `TelegramService`); se quitan con
  los envios al cliente.
- `saveUberScreenshot(fileId)` y `notifyReturnTransportAhead` solo los llama un
  handler de Telegram; el portal no tiene "no extender" y el regreso se adelanta
  solo desde el chat.
- `requestOpenEndedFinalPayment` (cuenta final de un servicio abierto) solo
  llega al cliente de Telegram; falta el aviso al chat web.
- Frontend: secciones de calificar en los portales y mostrar `motivo` en
  `no_drivers_available`; los push apuntan hoy a `/empleada/portal`,
  `/empleada/servicio`, `/chofer/portal` y `/jefe`.
- Columnas `telegram_empleada_mensaje_id`, `telegram_chofer_msg_oferta_id`,
  `telegram_empleada_msg_chofer_*` y `telegram_uber_file_id` ya no se escriben
  (salvo la ultima por la via del chat): borrarlas en la Fase 6.

Decisiones a confirmar:

- Conservar los envios al cliente de Telegram hasta la Fase 6 (criterio de
  B-schedulers); si se quieren quitar ya, hay que decidir que pasa con los
  clientes que solo usan el bot.
- El aviso de tres recordatorios de regreso iba a todos los jefes y admins;
  ahora va al jefe del servicio y a los admins.
- La cancelacion por demora y la racha de rechazos ahora avisan por push
  (antes solo por Telegram); la racha se puede silenciar con el interruptor de
  sanciones.

### Fase 5, B-grupos (backend)

Decision 6: servicio grupal del cliente web sin Telegram. El plan no detallaba
G1-G5; el implementador los definio asi (confirmar):

- G1, nacimiento: la solicitud nace de una conversacion web y la crea el jefe.
- G2, conversacion: mensajes del jefe, peticion de ubicacion y pin del chat.
- G3, cotizacion: al confirmarla, el cliente la recibe en su chat.
- G4, comprobante: el cliente lo sube por el chat y se cobra contra el saldo.
- G5, avisos: saldo, pago completo, rechazo del comprobante y push de inicio a
  las participantes.

Hecho:

- Migracion `1811005000000-LinkGroupRequestsToConversations`:
  `group_service_requests.conversation_id uuid NULL`, FK
  `fk_group_requests_conversation` a `conversations` con `ON DELETE SET NULL` e
  indice parcial `idx_group_requests_conversation`; idempotente y con `down`.
- `GrupoEnChatWebService` (`group-services/grupo-en-chat-web.service.ts`): todo
  lo del canal web. Depende solo de la base y de `ConversationNotifier`
  (`ConversationNotifierModule`): importar `ConversationsModule` cerraria un
  ciclo con `TelegramModule`.
- `ConversationNotifier.escribir({ conversationId, sender: 'jefe'|'sistema',
  texto })`: escritura dirigida que si lanza (404, y 409 si un `jefe` escribe
  en una cerrada); `notifyClient` no cambia.
- Rutas nuevas en `GroupServicesController` (`admin`, `jefe`):
  - `GET /group-services/chat-requests`: conversaciones no cerradas con
    `state.motivoDeEntrega = 'servicio_grupal'` y sin solicitud viva, con el
    alcance de la bandeja (`modelosAlAlcance`). Tope 50.
  - `POST /group-services/requests/from-conversation` (`{ conversationId }`,
    10/min): 404 fuera de alcance, 409 cerrada o si otro jefe ya organiza un
    grupo del cliente. Si el cliente ya tenia una solicitud viva sin chat web,
    se le engancha esta conversacion. Toma la conversacion para quien la crea
    (`HUMAN_ACTIVE`, solo si estaba con la IA o sin dueno) y avisa al cliente
    con el texto de la bandeja.
  - `POST /group-services/requests/:id/location-from-chat` (10/min): copia a
    la solicitud el ultimo pin `ubicacion` del cliente (y su direccion como
    referencia si no habia); 409 sin pin o si no viene del chat web.
- `CsrfGuard` a nivel de clase en `GroupServicesController` (deja pasar GET).
  Antes ninguna mutacion de grupos lo pedia; el panel ya manda el token.
- Rutas existentes con rama web cuando la solicitud tiene `conversationId`:
  `GET requests/:id/messages` lee los ultimos 200 mensajes de la conversacion
  con la forma `ConversationMessage` que ya pinta el panel (ubicacion como
  `location`, foto y comprobante como `photo`); `POST requests/:id/messages`
  escribe como `jefe` sin emojis; `request-location` deja un aviso; `catalog`
  responde 409 (el cliente web no elige: decision 6).
- Cotizacion: `confirmQuote` engancha el servicio a la conversacion
  (`service_id`, `con_servicio`, sin pisar otro) y deja la cotizacion:
  participantes vivas, duracion, traslado, total, pagado, forma de pago y, en
  transferencia con saldo, saldo y cuentas activas. Importes en centavos con
  `money.ts`, presentados en `es-MX`; los totales los calcula PostgreSQL
  (`calcular_total_servicio`).
- Comprobante: `servicioEsperaComprobante` en `comprobante-pendiente.ts` es el
  criterio unico; un grupal espera comprobante si es por transferencia y tiene
  `pending_balance > 0` (no usa `comprobante_pendiente`). Lo aplican la subida,
  el resumen del cliente y la bandeja (`joinServicioQueEsperaComprobante`). La
  subida registra `tipoCobro: 'grupal'` con el servicio ya enlazado, compara
  contra el saldo y deja como revisor al jefe del servicio, como Telegram. El
  dinero sigue entrando solo con CEP y `registerPayment`.
- Avisos web: saldo tras cualquier cambio que ya lo avisaba por Telegram;
  "pago completo" cuando un pago registrado deja el saldo en cero; rechazo
  manual del comprobante con el motivo pasado por `textoWebSeguro`. Los textos
  fijos no dicen nada de `PALABRAS_VETADAS_WEB` (spec).
- Inicio del grupal: el mensaje de Telegram con botones a cada participante se
  cambio por push (`/empleada/servicio`, `dedupeKey`
  `group_service_started:<servicio>:<modelo>`, sin nombres ni importes).
- Telegram al cliente se conserva en grupos (criterio de B-schedulers y
  B-emisores): mensajes, catalogo, ubicacion, saldo y rechazo siguen saliendo
  al cliente de Telegram; el web sale ademas, una vez por canal.
- Pruebas: `grupo-en-chat-web.service.spec.ts`,
  `group-services.chat-web.spec.ts`, `comprobante-pendiente.spec.ts`,
  `link-group-requests-to-conversations.spec.ts` y casos nuevos en
  `conversation-notifier.spec.ts` y `conversation-receipts.service.spec.ts`.

Pendiente:

- Frontend (no era de este carril): en `/jefe/grupos` listar
  `chat-requests` con boton "Armar grupo" (`from-conversation`), boton "Usar
  ubicacion del chat" y ocultar "Enviar catalogo" en solicitudes con
  `conversationId` (anadir el campo a `GroupServiceRequest` en
  `lib/types.ts`). El chat del grupo ya funciona con la forma actual. En
  `/chats/[id]` del cliente, el boton de comprobante aparece solo porque
  `comprobantePendiente` ya usa el criterio nuevo.
- Migracion y consultas sin probar contra Postgres real: `chat-requests`
  (`state->>`), la toma de control, el pin, el `JOIN` del comprobante con la
  rama grupal y el flujo completo cotizar, subir, confirmar CEP y registrar.
- Cancelar un grupal (`cancelService`, `releaseExpiredHolds`) no avisa al
  cliente por ningun canal, tampoco antes por Telegram.
- `releaseExpiredHolds` corre cada minuto en cada replica sin
  `withAdvisoryLock` (anterior a este carril); con varias replicas puede
  repetir el push de reserva vencida.
- Un grupal pagado en efectivo o tarjeta no se cobra por el chat; el mixto
  grupal tampoco (igual que en Telegram).
- Fase 6: borrar `openCatalog` por botones, `toggleCatalogSelection`,
  `confirmClientCatalog`, `findActiveRequestByClientTelegram`,
  `findRequestByThread`, `setTelegramThread`, `recordRequestConversation`,
  `telegram_thread_id` y los envios al cliente de Telegram.

Decisiones a confirmar:

- La solicitud web la crea el jefe desde el pedido del chat; el turno de la IA
  no la crea solo (en Telegram si). Evita un ciclo de modulos y deja al jefe
  decidir; si se quiere automatica, hace falta un evento entre modulos.
- Crear la solicitud toma la conversacion para quien la crea.
- Un jefe no puede abrir un grupo para un cliente que ya tiene uno con otro
  jefe (409); un admin si, y se queda con el jefe que ya lo organizaba.
- Que el pin del chat no se aplique solo a la solicitud: lo aplica el jefe.
- Texto del push de inicio y destino `/empleada/servicio` para el grupal.

## Fase 5, F-carril A: choferes y modo_bot (frontend)

- Eliminados `components/admin/ToggleModoBot.tsx` y `lib/actions/modo-bot.ts`, y
  el bloque "Modo de operacion" de `app/admin/drivers/[id]` y
  `app/admin/employees/[id]`. `modoBot` ya no aparece en `catalogo-cs`.
- `lib/ubicacion-fresca.ts` (con spec): umbral de 15 min, `ubicacionEstaVieja`
  (manda la bandera del backend; sin ella calcula, y sin marca cuenta como
  vieja) y `antiguedadDeUbicacion`.
- `components/drivers/ubicacion-badge.tsx`: insignia en dorado oscuro, usada por
  `driver-card.tsx` y `ChoferesDashboard.tsx`. Se corrigio el enlace roto de la
  tarjeta a `/admin/drivers/${id}`. `getChoferesAction` mapea
  `ubicacionVieja` y `ultimaUbicacionAt`; el detalle del chofer muestra la
  antiguedad.
- `LiveMap`: el evento `DRIVER_LOCATION_UPDATE` fija la marca a "ahora" y
  `ubicacionVieja = false`; el popup muestra la antiguedad, el marcador se
  atenua si esta vieja y un intervalo de 60 s recalcula.
- `app/jefe/mapa`: el jefe ve a todos los choferes (decision tomada).
- Pendiente: la insignia no tiene prueba de componente (solo logica pura).

### Fase 5, F-carril D (portal del chofer, pasos D1-D2)

Hecho:

- `lib/actions/driver-portal.ts`: `reportarEmpleadaDelViaje({ viajeId,
  categoria, descripcion })` sobre `POST /driver-portal/employee-reports`, solo
  con sesion (cookie y CSRF por `portalHeaders()`, sin token).
- `components/ui/ReportarConducta.tsx`: props opcionales y retrocompatibles
  `etiqueta`, `minimoDescripcion` (15 por defecto) y `revisor` (texto
  "un jefe" por defecto) para reutilizar el formulario sin duplicarlo.
- `components/chofer/DriverPortalView.tsx`, pestana "viajes": dos botones por
  viaje, "Reportar conducta" (lo revisa un jefe, `conduct_reports`) y, solo con
  sesion, "Reportar a administracion" (`employee_reports`), con una linea que
  los distingue. El segundo usa minimo 3 caracteres, el del backend. Enlace a
  `/chofer/reglamento` en la barra, solo con sesion.

Pendiente: D3 (retos); la pagina `/chofer/reglamento` debe existir en otro paso.

### Fase 5, F-carril F

Frontend de la evaluacion publica de candidatas (cierra el pendiente de
frontend de B-candidatas).

- `catalogo-cs/lib/candidata.ts`: `TOKEN_CANDIDATA`, `enlaceDeEvaluacion` y los
  tipos de la respuesta publica (locales, porque `lib/types.ts` es de otro
  carril). Spec en `lib/candidata.spec.ts`.
- `lib/actions/candidata-publica.ts`: `leerEvaluacion` y `responderEvaluacion`
  con `authenticated: false`; 404 devuelve `null`, 409 `{ conflicto: true }` y la
  UI vuelve a leer la pregunta pendiente.
- `app/candidata/[token]/page.tsx` y `components/candidata/EvaluacionCandidata.tsx`:
  pagina sin sesion (token invalido -> `notFound()`, `robots: { index: false }`,
  `referrer: no-referrer`), opciones como botones o textarea de 2 a 4000. No se
  toco `middleware.ts`: `/candidata/*` no esta en el matcher, asi que es publica.
- Admin: `CandidatasClient` genera el enlace web con
  `window.location.origin`; `CandidateDetailClient` pierde el texto de
  vinculacion con Telegram; `getCandidateScreeningTelegramUrl` se elimino de
  `lib/telegram-links.ts`.

Pendiente: `CandidateDetailClient` aun pasa `telegramChatId` al registrar (queda
vacio); sin prueba de componente de `EvaluacionCandidata`.


### Fase 5, F-carril C (portal de la empleada, pasos C1-C3)

- C1: `AvisoFotosSemanales` (`components/empleada/FotosSemanales.tsx`) trata la
  semana de gracia: texto "Esta semana es de gracia..." sin mencionar el
  importe de la multa; si los avisos se agotaron, ambar con "Esta semana no se
  aplico multa".
- C2: `getChoferesPorCalificar` y `calificarChofer` en
  `lib/actions/employee-portal.ts` (sin token, solo cookie). Nuevo
  `components/ui/CalificarPendientes.tsx` generico; `CalificarCliente` pasa a
  usarlo y `components/empleada/CalificarChofer.tsx` se monta en
  `EmployeePortalView` solo con sesion propia (`workShift` no nulo).
  `CalificarEmpleada.tsx` no se toco.
- C3: enlace "Reglamento" a `/empleada/reglamento` en la barra del portal, solo
  con sesion.
- Pendiente: C4 (retos). Sin pruebas de componente (no hay testing-library
  instalado); la pagina `/empleada/reglamento` debe existir en otro carril.

### Fase 5, F-carril R (retos del personal)

Backend: `GET /challenges/mine` (`ChallengesController`, declarado antes de
`:id`, con `@Roles('empleada','chofer')` a nivel de metodo) y
`ChallengesService.misRetos`. Resuelve `empleadas.id` o `choferes.id` por
`usuario_id` y devuelve los retos `active` y los `finished` de los ultimos 30
dias donde la persona participa: `{id, title, metric, status, startsAt, endsAt,
participantes, miPosicion, miValor, gane, top}`. Decision: la participante ve su
posicion y el top 3 con nombre (`top: [{posicion, nombre, valor, esMio}]`), no
los nombres de todas. El `url` de los push de retos es ahora
`/empleada/portal?seccion=retos` y `/chofer/portal?seccion=retos`.

Frontend: `lib/retos-del-personal.ts` (tipos y etiquetas),
`lib/actions/retos-del-personal.ts` (`obtenerMisRetos`, devuelve `[]` ante
fallo) y `components/ui/MisRetos.tsx` (generico, recibe `retos`, estado vacio
"No tienes retos activos").

Pendiente: integrar `MisRetos` en los portales de empleada y chofer con la
seccion `?seccion=retos` (otro paso). No se probo contra Postgres real.

### Fase 5, F-carril B

Valoracion del servicio en el chat del cliente (frontend de B-calificaciones-cliente).

- `lib/valoracion-del-servicio.ts` (+ spec): tipos `ServicioPorValorar` y
  `CalificacionDelCliente`, `MOTIVOS`, `categoriasDisponibles` (todas menos las
  ya reportadas, porque el indice unico del backend rechaza repetir) y
  `pideMotivo` (3 estrellas o menos).
- `lib/actions/valoracion-del-servicio.ts`: `calificarServicioAction`,
  `reportarServicioAction` y `volverAContratarAction`, con la misma traduccion
  de errores que `errorDeChat` (copiada: es privada en `conversaciones.ts`).
- `components/cliente/ValorarServicio.tsx`: una tarjeta por servicio con
  estrellas por modelo (en grupal, una fila por participante con `empleadaId`),
  motivo en chips con 3 estrellas o menos, comentario opcional, reportar un
  problema con select filtrado y "Volver a contratar a {nombre}".
- `VistaChat.tsx`: la tarjeta va junto a `SubirComprobante`, tambien con el chat
  cerrado; se relee lo pendiente en `message_created` y
  `conversation_status_changed` con un contador `recarga`.

Pendiente:

- En un grupal, "Volver a contratar" nombra a la modelo de este chat, pero el
  backend reabre con la principal del servicio; pueden diferir.
- Sin pruebas de componente (no hay testing-library); no se probo en navegador
  ni contra el backend real.
- Lista de choferes por calificar (portal de la modelo) y formulario de reporte
  del chofer siguen sin frontend.

### Fase 5, F-carril G (organizador grupal en el chat web)

- `lib/actions/jefe-panel.ts`: `getGroupChatRequests`,
  `createGroupRequestFromConversation` y `useGroupChatLocation` (esta ultima se
  importa con alias `tomarUbicacionDelChat` para no chocar con la regla de hooks).
- `JefeOperationsSectionPage.tsx` pide los pedidos con `optionalSource` y los
  pasa por `TeamOperations` (prop opcional `initialGroupChatRequests`) hasta
  `GroupServiceOrganizer`.
- `GroupServiceOrganizer.tsx`: bloque "Pedidos del chat" con "Armar grupo"
  (crea la solicitud, la quita del bloque, recarga y la selecciona). Si la
  solicitud tiene `conversationId`: encabezado "Acciones hacia el chat", sin
  "Enviar catalogo" y con "Usar ubicacion del chat" (el 409 se muestra tal cual).
- Backend: `GroupServicesService.findAll` carga `client.usuario` y devuelve
  `clientNombre` (sin exponer la entidad usuario); el frontend lo usa como
  respaldo de `nombreTelegram`. Spec en `group-services.chat-web.spec.ts`.

Pendiente: `clientNombre` no esta en `GroupServiceRequest` (types.ts no se toco),
se lee con una interseccion local; sin prueba de componente ni de navegador.

### Fase 5, F-retos en portales (C4 y D3)

- Pestana "Retos" en `EmployeePortalView.tsx` y `DriverPortalView.tsx`: pinta
  `components/ui/MisRetos.tsx` con la prop `retos`.
- `app/empleada/portal/page.tsx` y `app/chofer/portal/page.tsx` piden
  `obtenerMisRetos()` en paralelo con `getMyWorkShift()`, envuelto en
  `optionalSource`, y solo con sesion: `/challenges/mine` exige cookie y no sirve
  con `?token=` (sin sesion la lista llega vacia y se ve el estado vacio).
- La seccion `retos` se acepta en `?seccion=` de ambos portales; la del chofer
  ahora lee `?seccion=` (antes siempre abria en resumen), que es a donde apunta
  el push de retos.

Pendiente: sin prueba de componente ni de navegador; `tsc` y eslint limpios en
los archivos tocados.

### Fase 5, F-carril E (frontend del reglamento)

- `lib/reglamento.ts` (tipos copiados del backend, `estadoVisible`: aprobado,
  reprobado = `pending` con intentos, en curso, sin empezar) con spec;
  `lib/actions/reglamento.ts` (`getMiReglamento`, `empezarCuestionario`,
  `responderPregunta`).
- `components/reglamento/`: `VistaReglamento` (servidor; contenido como texto con
  `whitespace-pre-line`, nunca HTML), `Cuestionario` (cliente; una pregunta por
  pantalla, resultado con puntaje y mejor puntaje, "Intentar de nuevo", aviso de
  que no bloquea el trabajo) y `PaginaDeReglamento` (marco comun con la lectura
  envuelta en `optionalSource`).
- Rutas `/empleada/reglamento`, `/chofer/reglamento` (sesion propia, rol distinto
  va a `inicioParaRol`) y `/jefe/reglamento` (el admin ve "El administrador no
  tiene reglamento propio" sin llamar al backend, que le responde 403). Enlace
  desde `/jefe/ajustes`, no desde la barra. Las dos primeras entran al
  `matcher` del middleware para renovar el acceso, con caso en `middleware.spec.ts`.
- Backend: `DESTINO_POR_ROL` de `reglamento-web.service.ts` apunta a las tres
  rutas nuevas (el recordatorio ya no cae en el inicio).
- Pendiente: sin prueba de componentes ni navegador real (la suite del frontend
  no tiene testing-library instalada); `/jefe/reglamento` depende del middleware
  de `/jefe/:path*`, que ya exige jefe o admin.

## Fase 5, E3-1d

- Backend: `customer-booking-session.entity.ts` se movio con `git mv` de
  `telegram-conversations/entities/` a `booking/entities/`, donde vive el dueno
  de la sesion de reserva. Se reescribieron los 11 imports (booking,
  conversations, telegram-conversations y `telegram.module.ts`).
- Sin migracion: `data-source` carga `dist/**/*.entity.js` y ninguna migracion
  importa la entidad.
- Pendiente: nada propio de este paso.

### Fase 5, E3-1a (portales del backend a sesion web)

- `EmployeePortalController`, `EmployeePostsController` (`@Roles('empleada')`) y
  `DriverPortalController` (`@Roles('chofer')`) pasan de `PortalAuthGuard` a
  `@UseGuards(JwtAuthGuard, RolesGuard)`; `@PortalUser()` se sustituye por
  `@GetUser('id')`. `JwtAuthGuard` ya aplica CSRF.
- `GET /realtime/sse/chofer` usa `JwtAuthGuard` y responde 403 si el rol no es
  `chofer`, como los demas canales; `ApiSseTokenDocs` ya no declara `?token`.
- Eliminado `auth/decorators/portal-user.decorator.ts`. Comentarios de
  `posts.module.ts` y `portal-service-feedback.controller.ts` actualizados.
- Specs: `employee-posts.controller.spec` (guards de clase y rol),
  `employee-posts.media-http.spec` (override de `JwtAuthGuard` con
  `request.user`), `realtime.controller.spec` (chofer con user y 403 a rol ajeno).
- Pendiente (paso 2): borrar `PortalAuthGuard`, su spec y la parte de
  `auth.module`/`auth.controller`/`auth.service` que solo servia al portal.

### Fase 5, E3-1c: handlers de Telegram sin pases ni Mini App

- `telegram-portal-buttons.ts`: nueva `enlaceDelPanel(webUrl, ruta)` (pura) y
  `botonesDePortal` ofrece solo `Markup.button.url`; se elimina el boton webApp.
- `telegram-auth.update.ts`, `telegram-driver.update.ts` y
  `telegram-booking.update.ts` ya no inyectan `PanelAccessService`: mandan un
  enlace normal a `WEB_URL` + ruta (sin credencial) con el texto "Entra con tu
  correo y contrasena". Auth y driver inyectan `ConfigService`; se borra el
  calculo de minutos y el texto "sirve una sola vez". `/panel` sin destino cae
  en `/admin` o `/jefe` segun el rol.
- Specs: `telegram-portal-buttons.spec.ts` reescrito y `telegram-auth.update.spec.ts`
  sin `panelAccessService`.
- Pendiente (paso 2): borrar `PanelAccessService` y sus piezas; quitarlo de
  `telegram.module.ts` si aplicara.

### Fase 5, E3-1b (frontend: portales solo con sesion web)

- `middleware.ts`: fuera `canjearTokenDePortal` y el canje de `?token=`. La rama
  de `/empleada|chofer/portal` y `/servicio` solo renueva la sesion; se actualizo
  el comentario del matcher. `middleware.spec.ts` gana un bloque de portales (un
  `?token=` sin cookie no llama al backend y deja pasar; con el acceso caducado
  renueva con el refresh).
- `lib/actions/employee-portal.ts` y `driver-portal.ts`: ninguna funcion recibe
  `token`; `portalHeaders` ya no manda `Authorization` y `portalUrl` no agrega
  `?token=`.
- Paginas `empleada/portal`, `empleada/servicio`, `chofer/portal`,
  `chofer/servicio`: no leen `searchParams.token`; sin sesion van a `/ingresar`
  y con otro rol a `inicioParaRol(rol)`. La jornada y los retos se piden siempre,
  en paralelo con los datos del portal.
- Componentes de `components/empleada`, `components/chofer` y los cuatro de
  `components/ui` sin la prop `token`. `EmployeePortalView` y `DriverPortalView`
  sin el `useEffect` de `Telegram.WebApp`; los enlaces, `CompartirUbicacion`,
  `CalificarChofer`, `SolicitarServicio` y el reporte a administracion ya no
  dependen de `workShift`. `workShift` solo condiciona el interruptor de jornada,
  que necesita el valor inicial (llega `null` si la lectura fallo).
- Verificado: `tsc --noEmit` sin errores fuera de specs con testing-library, e2e
  y playwright; `jest middleware` 68 pruebas; eslint sin errores en los archivos
  tocados; el `rg` de control da 0.
- Pendiente: quedan menciones de Telegram en comentarios y textos de varios
  componentes (p. ej. `AccionesDelViaje`, `ServicioAhora`, `AgregarExtra`,
  `CompartirUbicacion`) que son de la limpieza de vinculacion; `app/acceso` y
  `app/ingresar` son del paso 3. Sin prueba de navegador.

### Fase 5, E3-1e (avisos y vinculacion de Telegram del personal)

- Backend: `discipline.service` sin `avisarPorChat` ni `TelegramService` (el push
  de `avisar()` ya cubria calificacion baja y reporte; el aviso de reporte pasa a
  `requireInteraction` por no ser silenciable). `driver-shifts.service`: asignar
  ya no manda chat; retirar manda push `turno-retirado-<turno>` a `/chofer/portal`
  con `dedupeKey` por asignacion y sin datos del turno en el texto.
  `team-channel.service`: fuera los dos envios por Telegram (jefe y modelo).
  `work-shift-status.service`: el aviso al jefe (principal y secundario, sin
  duplicar) es push a `/jefe/equipo`, sin nombre de la modelo ni motivo en el
  texto, con `dedupeKey` por cambio; se pierde el boton "Preguntar la razon" del
  aviso. `users.service`/`users.controller`: fuera `generateTelegramOtp`,
  `unlinkTelegram` y sus dos rutas. `TelegramModule` salio de los modulos
  discipline, driver-shifts, team-channel y users (este ultimo importa
  `NotificationsModule`); sin `forwardRef` sobrante.
- Frontend: borrados `estado-de-telegram.tsx` y `telegram-otp-button.tsx` y
  `generateTelegramOtpAction`; fuera su uso en `JefesDashboard`,
  `ChoferesDashboard` (con su columna), `ModelosDashboard` (no estaba en el
  encargo pero tambien lo importaba) y `expediente-modelo`; fuera el aviso
  `sinTelegram` de `asuntos-pendientes.ts` y la marca " · Sin Telegram" de
  `TeamOperations.tsx`.
- Specs ajustados: team-channel, work-shift-status, driver-shifts.candidates,
  version-del-reportado.
- Metrica: el `rg` da 8 archivos, todos del grupo A (app.module,
  services.module/service, service-schedule.scheduler, drivers.module,
  driver-trips.service, group-services.module/service).
- Pendiente: `asuntos-pendientes.ts` conserva los parametros `empleadas` y
  `choferes` sin uso (quitarlos toca a sus llamadores); los campos
  `telegramChatId` de los tipos del frontend y las columnas se quedan hasta la
  Fase 6.
