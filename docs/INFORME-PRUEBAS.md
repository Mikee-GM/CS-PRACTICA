# Informe de pruebas de extremo a extremo

Fecha: 23 de noviembre de 2026. Rama probada: `local-docker` (mismo código que
`fase-6-retirar-telegram` más el entorno local). Entorno: pila local de Docker
con los datos de demostración (`pnpm local:demo`), navegador Chrome y `curl`.

## Resumen

| Medida | Resultado |
|---|---|
| Tests unitarios del backend | 1.864 en 177 suites, todos en verde |
| Tests unitarios del frontend | 526 en 38 suites, todos en verde |
| Tests e2e contra Postgres real | 45 en 4 suites, en verde |
| Tipos (`tsc`) | Limpio en backend y frontend |
| Rutas de admin cargadas en navegador | 49 de 49 con 200, la más lenta 157 ms |
| Rutas del jefe cargadas en navegador | 14 de 14 con 200 |
| Vista móvil (390 px), 16 páginas | 0 con desbordamiento horizontal |
| Matriz de permisos (85 GET x 5 identidades) | Coherente; 1 fallo (500) corregido |
| Barrido de rutas que escriben (220 x 2 cuerpos) | 1 fallo (500) corregido |
| Hallazgos corregidos | 19 |
| Hallazgos abiertos | 7 (ninguno crítico) |

El lint no se pudo usar como señal: en Windows da 27.028 errores, todos de
`prettier` por los saltos de línea CRLF, ninguno de código.

## Hallazgos corregidos

Cada uno está en un commit con su prueba. Los dos críticos ya estaban en
producción (`origin/main`).

| # | Gravedad | Hallazgo | Corrección |
|---|---|---|---|
| 1 | Crítica | Terminar un viaje de **ida** daba 500. `finalizarViaje` ejecutaba `UPDATE servicios SET <nada>`, que TypeORM rechaza. El viaje quedaba `finalizado` pero el servicio no avanzaba, no se liquidaba al chofer ni se pedían las calificaciones. Una prueba existente exigía ese `update({})` y lo daba por bueno. | No escribir cuando no hay cambios; prueba corregida. |
| 2 | Crítica | El chofer **nunca recibía el push de la oferta de viaje**. `dispatchViaje` usa `.select([...])` sin `usuarioId` y el aviso se mandaba a `undefined` (error `null value in column "usuario_id"`). | Añadir `chofer.usuarioId` al select; prueba que lo fija. |
| 3 | Media | La web (Next) salía sin cabeceras de seguridad: se podía incrustar en un iframe ajeno y exponía `X-Powered-By`. El backend sí las mandaba. | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS y `Permissions-Policy` en `next.config.ts`; `poweredByHeader: false`. |
| 4 | Baja | Un cuerpo de más de 100 KB se devolvía como 500. | 413 en el filtro de excepciones; pruebas. |
| 5 | Baja | `GET /transport-operations/cash-payments` sin `employeeId` daba 500. | `ParseUUIDPipe`; ahora 400. |
| 6 | Baja | `PATCH /users/:id` con cuerpo vacío daba 500 (mismo error que el 1). | No ejecutar el update vacío; pruebas. |
| 7 | Baja | `DELETE /users/:id` de un usuario inexistente respondía `deleted: true`. | 404; pruebas. |
| 8 | Baja | Una prueba de `finalizarViaje` consagraba el comportamiento del hallazgo 1. | Corregida junto con el 1. |
| 9 | Baja | Un servicio cancelado conservaba el estado operativo anterior (`esperando_transporte_ida`). | Se fija `cancelado` en la misma transacción; prueba. |
| 10 | Baja (UX) | «Este servicio ya no está activo» para un servicio que aún no empezó. | «Todavía no ha empezado» para pendiente y agendado; el resto igual; pruebas. |
| 11 | Informativa | El mensaje del `ParseUUIDPipe` de `cash-payments` salía en inglés. | Mensaje en español. |

## Hallazgos abiertos

| # | Gravedad | Hallazgo | Sugerencia |
|---|---|---|---|
| A | Media (negocio) | Una modelo puede registrar un extra con tarjeta a **cualquier precio** (probé 500.000 por un extra de catálogo de 1.500) sin tope ni cotejo con el catálogo; infla el total del servicio. | Decidir un tope o exigir validación del jefe. |
| B | Baja (no se toca a propósito) | Si `/auth/me` responde 429 (más de 100 peticiones por minuto en una sesión), el frontend lo toma por «sin sesión» y manda a `/ingresar`. La sesión no se pierde: al pasar el minuto vuelve a funcionar. | Distinguir 429 y 5xx de 401 en `getCurrentUser` rompería el catálogo público si el backend cae un momento, porque esa página solo lo usa para mostrar «Mi panel»; haría falta un parámetro por página. |
| C | Baja | Asignar un chofer a mano con `reasignar-chofer` a un viaje que nunca se ofreció deja el servicio en `esperando_transporte_ida`. Después `picked-up` responde 409 pero el viaje queda `en_curso`: las escrituras del viaje y del servicio no son atómicas. | Envolver las transiciones en una transacción; es una refactorización mayor y se deja aparte. |
| E | Baja | El despacho no reintenta solo cuando el chofer actualiza su ubicación; hay que volver a pedir el transporte. Al chofer que no recibió la oferta se le dice «Otro chofer tomó este viaje primero». | Reintentar al llegar una ubicación nueva; mensaje más preciso. |
| G | Baja | Registrar un correo existente responde 409 «Ya existe una cuenta con ese correo», lo que revela qué correos tienen cuenta (el login sí es genérico). | Decisión de producto. |
| H | Baja | El límite de login por cuenta (5 por minuto) permite a un tercero impedir la entrada de una cuenta durante un minuto repitiendo intentos. | Aceptable por diseño; documentarlo o añadir un retardo progresivo. |
| I | Informativa | El campo de contraseña del formulario de nueva modelo es de tipo texto (visible). | Decidir si la contraseña inicial debe verse. |

## Segunda pasada: análisis más profundo

Se repitió la prueba con foco en lo que la primera dejó sin tocar: carreras de
concurrencia, dinero, acceso a recursos ajenos por identificador, contenido
que se pinta como enlace y validación con ids reales.

### Corregidos en la segunda pasada

| # | Gravedad | Hallazgo | Corrección |
|---|---|---|---|
| 12 | Alta | **Una empleada podía tener dos servicios en curso a la vez.** `startByEmployee` (el inicio desde el portal) no comprobaba que ya hubiera uno en curso; solo lo hacía `aceptar`. Con dos servicios listos, los dos se iniciaban, a la vez o uno tras otro, cada uno con su chofer. | Misma comprobación bajo el bloqueo de la fila de la empleada; una carrera de dos inicios da ahora un 200 y un 409. |
| 13 | Media | Una empleada podía **extender un servicio sin límite** y sin aprobación (llegué a 53 horas y 79.500 de total), saltándose el tope de 24 horas de la creación. | Tope de 24 horas sobre la duración total, también para el jefe. |
| 14 | Media | `linkX`, `fotoPerfilUrl` y `fotosExtra` aceptaban `javascript:` y `data:`, y la ficha pública pintaba `linkX` como `href`. | Solo `http` y `https` en el DTO (admite `localhost`), y la ficha filtra con `urlWebSegura`. |
| 15 | Baja | El reporte de liquidaciones de choferes daba 500 con una fecha ISO completa, y una fecha imposible (`2026-02-31`) se convertía en silencio en el 3 de marzo, desplazando el periodo de un corte de dinero. | Validación `AAAA-MM-DD` real en el DTO y en el servicio; 400. |
| 16 | Baja | `PATCH /clients/:id` y `PATCH /employees/:id` con cuerpo vacío (o solo `fotosExtra`) daban 500: mismo error de TypeORM que el hallazgo 1. | No ejecutar el update vacío. |
| 17 | Baja | Registrar un extra en el servicio de otra empleada daba 409 o 403 según el estado del servicio, lo que revelaba si estaba en curso. | Se comprueba primero quién eres. |
| 18 | Media (UX) | Un error del backend al guardar una modelo mostraba «An error occurred in the Server Components render…» en inglés y sin decir qué campo falló: Next oculta el texto de las excepciones de Server Actions en producción. | `create`, `update` y `delete` de modelos devuelven `{ ok, error }`; el usuario ve el motivo en español y el modal sigue abierto. |
| 19 | Media (UX) | Las otras 13 acciones que modifican datos (candidatas, disciplina y evidencias) tenían el mismo problema que la 18. | Devuelven el motivo en español con `ejecutarAccion` y `desenvolver`; 20 llamadas adaptadas sin tocar sus `try/catch`. Las lecturas y el flujo público de la candidata ya manejaban sus errores y no se tocaron. |

### Resultados que salieron bien

- **Concurrencia:** aceptar un servicio 6 veces a la vez da un solo 201; la
  empleada acepta 4 veces, una sola vale; pedir chofer 4 veces crea un solo
  viaje; dos choferes aceptando el mismo viaje, solo uno lo toma; terminar 5
  veces, una sola; 3 abonos del saldo completo, uno solo y los saldos cuadran
  (6.800 contra 6.800); 3 reversiones, todas rechazadas tras la primera; 6
  prórrogas dejan exactamente 3.
- **Invariantes de dinero en la base:** `total_final` igual a base más extras
  más transporte en todos los servicios, `total_extras` igual a la suma de sus
  extras, sin importes negativos, sin pagado mayor que el total, sin viajes
  duplicados, sin choferes en estado incoherente.
- **Acceso a recursos ajenos:** 17 casos entre empleadas, choferes, jefe y
  cliente, todos con 403 o 404.
- **Candidata por enlace público:** tokens de 72 bits, 404 con token falso, con
  SQL y con 5.000 caracteres, y 60 intentos por minuto.
- **Interfaz:** no hay `dangerouslySetInnerHTML` ni inserciones de HTML.
- **Servicio manual:** rechaza fecha basura, fecha futura y de más de 60 días.

### Abiertos nuevos

| # | Gravedad | Hallazgo | Sugerencia |
|---|---|---|---|
| J | Baja | `montoCobrado` de una solicitud de servicio manual no tiene tope (acepté 99.999.999). Pasa por aprobación del jefe. | Un máximo razonable. |

## Tercera pasada: dinero, cortes y conciliacion

Se construyo una **conciliacion de dinero** que recalcula cada importe desde los
servicios con SQL propio y lo compara con lo que el sistema guardo en otra parte.
Son 24 verificaciones (totales del servicio, extras y su comision con tarjeta,
registros de liquidacion, obligaciones de efectivo, abonos, cortes de choferes,
cortes semanales, deudas y multas). Esta en el Dashboard del administrador y en
`GET /liquidations/conciliacion`.

**Resultado de la prueba de extremo a extremo** (`pnpm qa:dinero`): 16 servicios con
importes con centavos, los tres metodos de pago, extras, extensiones, lugares
predefinidos y cancelaciones; despues abonos parciales y exactos, un centavo de mas
(rechazado), cortes semanales, un corte de chofer y multas con reversa. En los 8
puntos de control la conciliacion dio **0 discrepancias**, y las cifras del resumen
coinciden con un calculo directo en SQL.

**Prueba inversa:** al corromper a proposito la base, la conciliacion detecto todas
las clases de error (comision, neto, servicio sin registro, base, abonos, estado,
corte de chofer, viaje fuera de corte y corte recalculado). El total del servicio no
se pudo corromper: lo restaura el trigger de la base. El boton de regenerar un
registro se niega con un 409 si el corte de esa semana ya esta confirmado.

### Corregidos

| # | Gravedad | Hallazgo | Correccion |
|---|---|---|---|
| 20 | Alta | **Revocar una multa borraba todas las parecidas.** La multa y su registro del corte se unian por empleada, importe y un trozo del motivo (`LIKE`): dos multas iguales desaparecian juntas, y una multa ya incluida en un corte pagado lo cambiaba despues. | `sanction_id` en el registro (migracion); se borra solo el de esa sancion, y si el corte ya esta confirmado se anota una reversa negativa en la primera semana abierta. |
| 21 | Media | Los cortes sumaban dinero con `Number`: `0.1 + 0.2 > 0.3` rechazaba el **ultimo abono legitimo de una deuda**, y una obligacion podia quedarse `pendiente` con saldo cero. | Centavos enteros (`money.ts`) en el corte, la confirmacion y las deudas. |
| 22 | Media | **Todos los cortes semanales guardaban `week_end` un dia de mas** (el lunes siguiente): el domingo 23:59 de Mexico ya es lunes en UTC. Ademas, el grafico diario mandaba los servicios de la noche al dia siguiente. | `fechaDelNegocio` en todos los puntos; migracion que corrige los cortes ya guardados. |
| 23 | Media | La siembra de demostracion se contradecia (obligaciones de efectivo sobre servicios por transferencia, abonos sin repartir, cortes sin sus viajes, una multa revocada que seguia descontando): la conciliacion nacia con decenas de discrepancias. | La siembra regenera lo derivado con las reglas reales del sistema. |
| 24 | Media | **El corte semanal del Centro de Mando perdia desde el sabado por la tarde y no veia los cortes confirmados** (decia 0 de 3 aunque hubiera 3): mandaba fechas planas (`2026-11-23`) y el backend las tomaba como medianoche UTC, que en Mexico es el sabado a las 18:00. El filtro de reportes tenia el mismo defecto. | Una fecha plana es un dia del calendario del negocio (`inicioDelDia` y `finDelDia`); un instante completo se respeta tal cual. |

### Resueltos con las decisiones del negocio

| # | Decision | Que hace ahora el sistema |
|---|---|---|
| L | Las multas a choferes se descuentan | Cada multa activa se descuenta del siguiente corte del chofer, de la mas antigua a la mas nueva, mientras quepa en lo que gano (el pago nunca queda negativo; la que no cabe espera al corte siguiente). Deshacer el corte la libera. Columna `driver_settlement_id` en la sancion. |
| M | Un servicio a domicilio creado por el jefe lleva cargo de transporte | Igual que el chat de reserva: un lugar predefinido no lleva cargo y una direccion externa lleva la tarifa configurada. |
| N | Un viaje terminado con el corte de su semana pagado se paga en el siguiente | Queda sin corte y lo recoge el corte pendiente de la primera semana abierta. La conciliacion exige que exista ese corte posterior. |
| O | Un servicio tardio en una semana confirmada se compensa en la siguiente | El registro entra con la fecha del lunes de la primera semana abierta; la semana pagada no se toca. Un registro que ya vive en una semana confirmada conserva su fecha. |
| P | Sin tope en extras con tarjeta ni en el monto de un servicio manual | Sin cambios, por decision del negocio. |

Pendiente menor: la multa y su registro del corte se siguen creando en dos pasos sin
transaccion (`conciliacion` lo detecta si falla el segundo).

## Qué se probó

**Autenticación y sesión.** Login correcto e incorrecto con mensaje idéntico
para cuenta real y falsa, límite de 5 intentos por minuto por cuenta, cierre de
sesión que invalida los tokens en el servidor, reutilización de un token de
renovación que revoca la familia, protección CSRF (sin token, con token
distinto, con token correcto), cookies firmadas.

**Permisos.** Matriz de 85 rutas GET con cinco identidades (anónimo, admin,
jefe, empleada, chofer): anónimo siempre 401, rutas de admin cerradas al resto,
portales aislados por rol. El cliente queda aislado de todas las rutas de
personal; otro cliente no puede leer ni escribir en una conversación ajena (404).

**Entradas.** Cuerpos vacíos y con campos de más en 220 rutas que escriben, JSON
malformado, cuerpo gigante, nombres con HTML y SQL (se guardan como texto y se
muestran escapados), subida de archivos (solo JPEG, PNG y WEBP reales: se
rechazan HTML, ejecutables, un HTML disfrazado de PNG y archivos sin cuerpo;
tope de 20 MB; el archivo subido se sirve como `image/png`).

**Ciclo de vida de un servicio, de punta a punta.** Crear (los importes los
calculan los triggers), aceptar el jefe, aceptar la empleada, pedir chofer
interno, oferta al chofer, aceptar, llegar, recoger, terminar la ida, iniciar,
registrar extras (efectivo rechazado, precios negativos y cero rechazados),
terminar, transporte de regreso y cierre con liquidación `cerrada`.
Disciplina: un cliente con suspensión activa no puede recibir servicios.

**Chat web.** Registro del cliente (términos, mayoría de edad, clave, correo),
crear conversación, enviar mensaje, reenvío idempotente, aviso al cliente con
la IA apagada, el jefe ve la conversación, la toma y responde, el cliente recibe
la respuesta.

**Tiempo real (SSE).** Sin sesión 401, rol incorrecto 403, el jefe recibe
latido y ubicaciones de chofer y empleada al instante.

**Interfaz en Chrome.** Login y cierre de sesión por rol, panel de admin, panel
del jefe, portal de la empleada, catálogo y ficha pública, formulario de nueva
modelo (validación y cierre con Escape con el foco devuelto al botón),
formulario de servicio manual, y vista móvil de 16 páginas.

## Qué no se probó

- **IA del chat:** sin clave de xAI. Solo se vio el aviso de respaldo.
- **Notificaciones push reales:** sin claves VAPID; solo se comprobó que el
  evento se reserva bien.
- **Correo:** sin SMTP; no se ejecutó la verificación del correo.
- **Portal del chofer en pantalla:** se probó por API y por carga de ruta, no
  con capturas.
- **Sin ejecutar:** publicaciones y vídeo del feed, candidatas por enlace público,
  contenido semanal, retos, reglamento y onboarding, servicios en grupo,
  prórrogas y extensiones, botón de pánico, calificaciones y apelaciones, cortes
  y pagos de liquidaciones, interacción con el mapa, y la matriz de permisos
  para peticiones que escriben (solo se barrió con admin).
- **Producción:** nada de esto prueba la migración de la fase 6 sobre los datos
  reales; solo sobre una base vacía.

## Notas sobre los datos de demostración

Algunos datos de la siembra impiden probar el despacho en vivo sin ajustarlos:
el chofer 1 trae un viaje activo y turnos asignados que lo dejan fuera del
reparto, la ubicación sembrada caduca a los 15 minutos, el cliente 41 tiene una
suspensión activa a propósito, y las fotos de las modelos apuntan a archivos que
no existen en el almacenamiento local. No son fallos del sistema.
