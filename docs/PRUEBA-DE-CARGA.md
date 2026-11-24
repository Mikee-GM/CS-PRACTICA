# Prueba de carga

Se ejecuta con `pnpm qa:carga` (script `scripts/qa/carga.mjs`) contra el entorno local
de Docker. Cada usuario virtual es una cuenta propia, porque el limitador cuenta por
sesion (100 peticiones por minuto) y los mensajes de chat tienen su propio tope.

**Los numeros son de una sola maquina y sirven para comparar antes y despues de un
cambio, no como capacidad de produccion.**

## Resultados

### HTTP: 40 clientes con sesion, 40 s, ~1 peticion por segundo cada uno

Todas las rutas con 100 % de exito, sin 429 ni 5xx.

| Paso | Peticiones | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| mi cuenta (API) | 182 | 5 | 21 | 214 |
| catalogo publico (web) | 207 | 6 | 28 | 145 |
| ficha de modelo (web) | 190 | 7 | 19 | 117 |
| mis chats (web) | 210 | 37 | 406 | 421 |
| catalogo (API directa) | 195 | 13 | 38 | 125 |
| catalogo (API via Next) | 220 | 20 | 261 | 372 |
| mis chats (API) | 194 | 8 | 22 | 250 |

El paso mas lento es «mis chats (web)» (p95 406 ms): es una pagina renderizada en
servidor que pide varias fuentes en paralelo.

### SSE: 150 flujos en vivo abiertos a la vez durante 30 s

- 150 de 150 abiertos, 0 caidos; conexion p95 18 ms.
- Conexiones del frontend hacia el backend: 2 en reposo, 152 con los flujos abiertos,
  **2 seis segundos despues de cerrarlos**: no quedan conexiones huerfanas (el defecto
  del proxy que las dejaba abiertas esta corregido).
- Memoria del backend estable (~117 MiB) y CPU por debajo del 1 %.

### Chat: 30 clientes, 50 s

abrir conversacion p95 35 ms, enviar mensaje p95 38 ms, leer mensajes p95 20 ms; 100 %
de exito sin limitaciones.

## Lo que no se midio

- Carga de la base con datos de produccion (la demostracion tiene pocas filas).
- Mas de 150 flujos simultaneos ni varias replicas del backend.
- Subida de imagenes ni llamadas al proveedor de IA.
