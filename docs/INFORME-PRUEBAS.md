# Informe de pruebas de extremo a extremo

Fecha: 23 de noviembre de 2026. Rama probada: `local-docker` (mismo código que
`fase-6-retirar-telegram` más el entorno local). Entorno: pila local de Docker
con los datos de demostración (`pnpm local:demo`), navegador Chrome y `curl`.

## Resumen

| Medida | Resultado |
|---|---|
| Tests unitarios del backend | 1.825 en 171 suites, todos en verde |
| Tests unitarios del frontend | 502 en 34 suites, todos en verde |
| Tests e2e contra Postgres real | 21 en 3 suites, en verde (primera vez que se ejecutan) |
| Tipos (`tsc`) | Limpio en backend y frontend |
| Rutas de admin cargadas en navegador | 49 de 49 con 200, la más lenta 157 ms |
| Rutas del jefe cargadas en navegador | 14 de 14 con 200 |
| Vista móvil (390 px), 16 páginas | 0 con desbordamiento horizontal |
| Matriz de permisos (85 GET x 5 identidades) | Coherente; 1 fallo (500) corregido |
| Barrido de rutas que escriben (220 x 2 cuerpos) | 1 fallo (500) corregido |
| Hallazgos corregidos | 11 |
| Hallazgos abiertos | 6 (ninguno crítico) |

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
