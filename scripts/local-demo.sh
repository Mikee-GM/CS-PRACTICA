#!/bin/sh
# Carga datos de demostracion en el entorno local de Docker y deja a los
# usuarios demo con una clave conocida para poder entrar con ellos.
#
# El script de siembra pone a proposito un hash falso: asi esas cuentas no
# sirven para entrar si alguien las siembra en un servidor real. Aqui, en la
# base local, se les asigna una clave conocida. Solo toca correos
# `@ejemplo.local`, y se puede repetir sin problema.
#
# Requiere el entorno arriba: `pnpm local:up`.
set -eu

COMPOSE="docker compose -f docker-compose.local.yml"
CLAVE='Demo-Local-2026!'

echo "Sembrando la operacion de demostracion..."
$COMPOSE exec -T backend node dist/scripts/sembrar-datos-demo.js --confirmar >/dev/null

echo "Asignando la clave a los usuarios demo..."
$COMPOSE exec -T -e CLAVE_DEMO="$CLAVE" backend node -e "
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
(async () => {
  const db = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
  await db.connect();
  const hash = await bcrypt.hash(process.env.CLAVE_DEMO, 10);
  const r = await db.query(
    \"UPDATE usuarios SET password_hash = \$1, debe_cambiar_password = false WHERE email LIKE '%@ejemplo.local'\",
    [hash],
  );
  console.log(r.rowCount + ' usuarios actualizados');
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
"

echo
echo "Listo. Entra en http://localhost:3000 con cualquiera de estos:"
echo "  demo.admin@ejemplo.local    (admin)"
echo "  demo.jefe1@ejemplo.local    (jefe)   demo.jefe2@ejemplo.local"
echo "  demo.modelo1@ejemplo.local  (empleada, hasta modelo3)"
echo "  demo.chofer1@ejemplo.local  (chofer, hasta chofer2)"
echo "  clave de todos: $CLAVE"
