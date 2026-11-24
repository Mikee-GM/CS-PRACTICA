#!/usr/bin/env node
/**
 * Prueba de carga del entorno local.
 *
 * Sin dependencias: usa `fetch` de Node. Tres escenarios, porque el sistema se
 * comporta distinto en cada uno:
 *
 *   http   Tráfico mixto de clientes con sesión (catalogo, cuenta, chats, perfil).
 *   sse    Muchos flujos en vivo abiertos a la vez por el proxy de Next.
 *   chat   Clientes que abren conversacion y mandan mensajes.
 *
 * El limitador del backend cuenta por sesion (100 peticiones por minuto, 6
 * mensajes por minuto), asi que cada usuario virtual es una cuenta propia: una
 * sola cuenta con mucha carga solo mediria el limitador. Lo que se mide es cuantas
 * SESIONES simultaneas aguanta el sistema con buena latencia.
 *
 * Uso:
 *   node scripts/qa/carga.mjs --escenario http --usuarios 40 --segundos 40
 *   node scripts/qa/carga.mjs --escenario sse  --usuarios 150 --segundos 30
 *   node scripts/qa/carga.mjs --escenario chat --usuarios 30 --segundos 60
 *   node scripts/qa/carga.mjs --escenario todo
 *
 * Los resultados dependen de la maquina: sirven para comparar antes y despues de
 * un cambio, no como cifra absoluta de produccion.
 */
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const CONTENEDORES = (process.env.CONTENEDORES ?? 'colombia-sexys-local-frontend-1,colombia-sexys-local-backend-1,colombia-sexys-local-db-1').split(',');

const arg = (nombre, porDefecto) => {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : porDefecto;
};
const ESCENARIO = arg('--escenario', 'todo');
const USUARIOS = Number(arg('--usuarios', 0));
const SEGUNDOS = Number(arg('--segundos', 0));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- metricas
class Metricas {
  constructor() {
    this.muestras = new Map();
  }
  anotar(nombre, ms, estado) {
    if (!this.muestras.has(nombre)) this.muestras.set(nombre, []);
    this.muestras.get(nombre).push({ ms, estado });
  }
  informe(duracionSeg) {
    const filas = [];
    for (const [nombre, datos] of this.muestras) {
      const ordenados = datos.map((d) => d.ms).sort((a, b) => a - b);
      const pct = (p) => ordenados[Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length))];
      const buenos = datos.filter((d) => d.estado >= 200 && d.estado < 400).length;
      const limitados = datos.filter((d) => d.estado === 429).length;
      const caidos = datos.filter((d) => d.estado === 0 || d.estado >= 500).length;
      filas.push({
        paso: nombre,
        peticiones: datos.length,
        porSegundo: +(datos.length / duracionSeg).toFixed(1),
        ok: `${((buenos / datos.length) * 100).toFixed(1)}%`,
        limitadas429: limitados,
        errores5xx: caidos,
        p50: Math.round(pct(50)),
        p95: Math.round(pct(95)),
        p99: Math.round(pct(99)),
        max: Math.round(ordenados[ordenados.length - 1]),
      });
    }
    return filas;
  }
}

// ---------------------------------------------------------------- sesiones
class Cliente {
  constructor(indice) {
    this.indice = indice;
    this.cookies = new Map();
    this.correo = `carga.${Date.now()}.${indice}@ejemplo.local`;
  }
  cabeceraDeCookies() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  guardar(res) {
    for (const linea of res.headers.getSetCookie?.() ?? []) {
      const [par] = linea.split(';');
      const i = par.indexOf('=');
      this.cookies.set(par.slice(0, i), par.slice(i + 1));
    }
  }
  async pedir(metricas, nombre, metodo, url, cuerpo) {
    const cabeceras = { 'content-type': 'application/json' };
    if (this.cookies.size) cabeceras.cookie = this.cabeceraDeCookies();
    const csrf = this.cookies.get('csrf_token');
    if (csrf && metodo !== 'GET') cabeceras['x-csrf-token'] = csrf;
    const t0 = performance.now();
    let estado = 0;
    let json = null;
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: cabeceras,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        redirect: 'manual',
      });
      estado = res.status;
      this.guardar(res);
      const texto = await res.text();
      try {
        json = JSON.parse(texto);
      } catch {
        /* una pagina, no JSON */
      }
    } catch {
      estado = 0;
    }
    metricas?.anotar(nombre, performance.now() - t0, estado);
    return { estado, json };
  }
  async registrar() {
    const r = await this.pedir(null, 'registro', 'POST', `${API}/auth/register`, {
      email: this.correo,
      password: 'Segura2026x',
      nombre: `Carga ${this.indice}`,
      mayorDeEdad: true,
      aceptaTerminos: true,
    });
    if (r.estado !== 201) throw new Error(`registro ${this.indice}: ${r.estado} ${JSON.stringify(r.json)}`);
  }
}

async function crearClientes(n) {
  process.stdout.write(`Registrando ${n} cuentas de prueba`);
  const clientes = [];
  for (let i = 0; i < n; i += 1) {
    const c = new Cliente(i);
    await c.registrar();
    clientes.push(c);
    if (i % 10 === 9) process.stdout.write('.');
  }
  console.log(' listo');
  return clientes;
}

// ---------------------------------------------------------------- recursos
function recursos() {
  try {
    const salida = execSync(
      `docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}" ${CONTENEDORES.join(' ')}`,
      { encoding: 'utf8' },
    );
    return Object.fromEntries(
      salida
        .trim()
        .split('\n')
        .map((l) => l.split('|'))
        .map(([nombre, cpu, mem]) => [nombre.replace('colombia-sexys-local-', ''), `${cpu} / ${mem.split(' / ')[0]}`]),
    );
  } catch {
    return {};
  }
}

function conexionesAlBackend() {
  // Se lee /proc/net/tcp del contenedor y se cuenta aqui: meter un awk dentro de
  // `docker exec` obliga a escapar comillas por tres capas.
  try {
    const crudo = execSync(`docker exec ${CONTENEDORES[0]} sh -c "cat /proc/net/tcp /proc/net/tcp6"`, {
      encoding: 'utf8',
    });
    return crudo
      .split(String.fromCharCode(10))
      .map((linea) => linea.trim().split(/\s+/))
      .filter((campos) => campos[3] === '01' && campos[2]?.split(':')[1]?.toUpperCase() === '0FA0').length;
  } catch {
    return null;
  }
}

function titulo(texto) {
  console.log(`\n== ${texto}`);
}

function mostrar(filas) {
  console.table(filas);
}

// ---------------------------------------------------------------- escenario http
async function escenarioHttp(usuarios, segundos) {
  titulo(`HTTP: ${usuarios} clientes con sesion, ${segundos} s, ~1 peticion por segundo cada uno`);
  const clientes = await crearClientes(usuarios);
  const metricas = new Metricas();
  const fin = Date.now() + segundos * 1000;
  const antes = recursos();

  const pasos = [
    ['catalogo publico (web)', (c) => c.pedir(metricas, 'catalogo publico (web)', 'GET', `${WEB}/`)],
    ['ficha de modelo (web)', (c) => c.pedir(metricas, 'ficha de modelo (web)', 'GET', `${WEB}/modelos/valentina-demo`)],
    ['catalogo (API via Next)', (c) => c.pedir(metricas, 'catalogo (API via Next)', 'GET', `${WEB}/api/catalog/employees`)],
    ['catalogo (API directa)', (c) => c.pedir(metricas, 'catalogo (API directa)', 'GET', `${API}/catalog/employees`)],
    ['mi cuenta (API)', (c) => c.pedir(metricas, 'mi cuenta (API)', 'GET', `${API}/auth/me`)],
    ['mis chats (API)', (c) => c.pedir(metricas, 'mis chats (API)', 'GET', `${API}/conversations`)],
    ['mis chats (web)', (c) => c.pedir(metricas, 'mis chats (web)', 'GET', `${WEB}/chats`)],
  ];

  let pico = antes;
  const vigilante = setInterval(() => {
    pico = recursos();
  }, Math.max(5000, (segundos * 1000) / 3));

  await Promise.all(
    clientes.map(async (cliente, i) => {
      await dormir((i * 1000) / usuarios); // escalonados: no todos a la vez
      while (Date.now() < fin) {
        const [, paso] = pasos[Math.floor(Math.random() * pasos.length)];
        await paso(cliente);
        await dormir(700 + Math.random() * 600);
      }
    }),
  );
  clearInterval(vigilante);
  mostrar(metricas.informe(segundos));
  console.log('Recursos (CPU / memoria) antes:', antes);
  console.log('Recursos (CPU / memoria) durante:', pico);
  console.log('Despues:', recursos());
}

// ---------------------------------------------------------------- escenario sse
async function escenarioSse(usuarios, segundos) {
  titulo(`SSE: ${usuarios} flujos en vivo abiertos a la vez durante ${segundos} s`);
  const clientes = await crearClientes(usuarios);
  const base = conexionesAlBackend();
  const antes = recursos();
  const tiempos = { conexion: [], primerLatido: [] };
  let abiertos = 0;
  let caidos = 0;
  let mensajes = 0;

  const controlador = new AbortController();
  const abrir = async (cliente) => {
    const t0 = performance.now();
    try {
      const res = await fetch(`${WEB}/api/realtime/sse?canal=cliente`, {
        headers: { cookie: cliente.cabeceraDeCookies(), accept: 'text/event-stream' },
        signal: controlador.signal,
      });
      if (res.status !== 200) {
        caidos += 1;
        return;
      }
      tiempos.conexion.push(performance.now() - t0);
      abiertos += 1;
      const lector = res.body.getReader();
      let primero = true;
      for (;;) {
        const { done, value } = await lector.read();
        if (done) {
          caidos += 1;
          return;
        }
        if (primero && value?.length) {
          tiempos.primerLatido.push(performance.now() - t0);
          primero = false;
        }
        mensajes += 1;
      }
    } catch {
      if (!controlador.signal.aborted) caidos += 1;
    }
  };

  const tareas = clientes.map((c, i) => dormir((i * 2000) / usuarios).then(() => abrir(c)));
  await dormir(Math.min(8000, 2500 + usuarios * 20));
  const pico = recursos();
  const conexionesPico = conexionesAlBackend();
  await dormir(segundos * 1000);
  controlador.abort();
  await Promise.allSettled(tareas);
  await dormir(6000);
  const despues = recursos();
  const finales = conexionesAlBackend();

  const ord = (a) => [...a].sort((x, y) => x - y);
  const pct = (a, p) => (a.length ? Math.round(ord(a)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]) : null);
  mostrar([
    {
      solicitados: usuarios,
      abiertos,
      caidos,
      conexionP50: pct(tiempos.conexion, 50),
      conexionP95: pct(tiempos.conexion, 95),
      primerLatidoP95: pct(tiempos.primerLatido, 95),
      fragmentosRecibidos: mensajes,
    },
  ]);
  console.log('Conexiones del frontend hacia el backend: base', base, '| con los flujos abiertos', conexionesPico, '| 6 s despues de cerrarlos', finales);
  console.log(
    finales !== null && base !== null && finales <= base + 1
      ? '  ok   no quedan conexiones huerfanas'
      : '  FALLA quedan conexiones abiertas tras desconectar los clientes',
  );
  console.log('Recursos antes:', antes);
  console.log('Recursos con los flujos abiertos:', pico);
  console.log('Recursos despues:', despues);
}

// ---------------------------------------------------------------- escenario chat
async function escenarioChat(usuarios, segundos) {
  titulo(`Chat: ${usuarios} clientes abren conversacion y escriben cada ~12 s durante ${segundos} s`);
  const clientes = await crearClientes(usuarios);
  const metricas = new Metricas();
  const fin = Date.now() + segundos * 1000;
  const empleada = process.env.EMPLEADA_ID ?? 'deadbeef-0000-4000-8000-000000000020';

  await Promise.all(
    clientes.map(async (cliente, i) => {
      await dormir((i * 3000) / usuarios);
      const conv = await cliente.pedir(metricas, 'abrir conversacion', 'POST', `${API}/conversations`, { employeeId: empleada });
      const id = conv.json?.id;
      if (!id) return;
      while (Date.now() < fin) {
        await cliente.pedir(metricas, 'enviar mensaje', 'POST', `${API}/conversations/${id}/messages`, {
          body: `Hola, mensaje de carga ${Math.random().toString(36).slice(2, 8)}`,
          clientMessageId: crypto.randomUUID(),
        });
        await cliente.pedir(metricas, 'leer mensajes', 'GET', `${API}/conversations/${id}/messages`);
        await dormir(10000 + Math.random() * 4000);
      }
    }),
  );
  mostrar(metricas.informe(segundos));
  console.log('Recursos al final:', recursos());
}

// ---------------------------------------------------------------- principal
async function main() {
  console.log(`Prueba de carga. Web ${WEB}, API ${API}.`);
  const corrida = {
    http: () => escenarioHttp(USUARIOS || 40, SEGUNDOS || 40),
    sse: () => escenarioSse(USUARIOS || 150, SEGUNDOS || 30),
    chat: () => escenarioChat(USUARIOS || 30, SEGUNDOS || 50),
  };
  const lista = ESCENARIO === 'todo' ? ['http', 'sse', 'chat'] : [ESCENARIO];
  for (const nombre of lista) {
    if (!corrida[nombre]) {
      console.error(`Escenario desconocido: ${nombre}`);
      process.exit(2);
    }
    await corrida[nombre]();
  }
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(2);
});
