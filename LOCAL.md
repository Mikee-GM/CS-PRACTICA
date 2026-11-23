# Entorno local con Docker

Esta rama (`local-docker`) corre completa en local con un solo comando. No es
para desplegar: el esquema se aplica con una unica migracion base y las claves
son de ejemplo.

```bash
docker compose -f docker-compose.local.yml up --build
```

(o `pnpm local:up`). La primera vez tarda unos minutos en construir las
imagenes; despues arranca en segundos.

| Servicio | Direccion |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Archivos (compatible con S3) | http://localhost:9000/colombia-sexys |
| PostgreSQL | localhost:5434, usuario, clave y base `colombia_sexys` |

Administrador inicial: `admin@example.com` / `Admin-Local-2026!`

## Que hace solo

- Crea la base y aplica la migracion base (`backend/src/migrations/1900000000000-EsquemaBase.ts`).
- Crea el administrador inicial y los datos de referencia (reglamento, ajustes
  de liquidacion y de transporte).
- Crea el bucket de archivos; las subidas funcionan sin Cloudflare R2.
- No hace falta ningun `.env`.

## Comandos utiles

```bash
pnpm local:up        # levantar (construye si hace falta)
pnpm local:down      # parar, conservando los datos
pnpm local:reset     # parar y BORRAR la base y los archivos locales
pnpm local:logs      # ver los logs
```

Si un puerto esta ocupado, cambialo con variables: `LOCAL_WEB_PORT`,
`LOCAL_API_PORT`, `LOCAL_DB_PORT`, `LOCAL_STORAGE_PORT`. Ojo: si cambias
`LOCAL_WEB_PORT` o `LOCAL_STORAGE_PORT`, ajusta tambien `WEB_URL` y
`R2_PUBLIC_URL` en el compose.

La IA del chat queda apagada salvo que exportes `XAI_API_KEY` antes de levantar.

## Datos de prueba

Con el entorno arriba, un solo comando siembra una operacion completa de
demostracion (modelos, jefes, choferes, clientes y servicios en todos sus
estados):

```bash
bash scripts/local-demo.sh        # o: pnpm local:demo
```

Se puede repetir: limpia lo sembrado antes de volver a sembrar. Deja a los
usuarios demo con la clave `Demo-Local-2026!`:

| Correo | Rol |
|---|---|
| `demo.admin@ejemplo.local` | admin |
| `demo.jefe1@ejemplo.local`, `demo.jefe2@ejemplo.local` | jefe |
| `demo.modelo1@ejemplo.local` a `demo.modelo3@ejemplo.local` | empleada |
| `demo.chofer1@ejemplo.local`, `demo.chofer2@ejemplo.local` | chofer |

Para borrar solo lo sembrado, sin tocar el resto:

```bash
docker compose -f docker-compose.local.yml exec backend   node dist/scripts/sembrar-datos-demo.js --limpiar --confirmar
```

## Cambios respecto a `main`

- Las 96 migraciones historicas se sustituyen por un esquema base unico,
  generado con `pg_dump` tras aplicarlas todas sobre PostgreSQL 16 vacio. No tiene
  `down`: para rehacer la base, `pnpm local:reset`.
- La imagen del backend aplica las migraciones pendientes al arrancar.
- `R2_FORCE_PATH_STYLE` (nueva, opcional) para almacenamiento S3 local, y
  `NEXT_IMAGE_UNOPTIMIZED` en el build del frontend.
