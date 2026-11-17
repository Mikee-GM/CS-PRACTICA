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
