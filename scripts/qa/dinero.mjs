#!/usr/bin/env node
/**
 * Prueba de extremo a extremo del manejo de dinero.
 *
 * Recorre por la API real (la misma que usa el panel) muchos servicios con
 * importes aleatorios --con centavos, los tres metodos de pago, extras, extensiones
 * y cancelaciones--, y despues abonos de efectivo, cortes semanales, cortes de
 * choferes, multas y reversiones. Despues de cada fase consulta la conciliacion
 * (`GET /liquidations/conciliacion`) y exige cero discrepancias.
 *
 * Requiere el entorno local con datos de demostracion (`pnpm local:up` y
 * `pnpm local:demo`). Uso:
 *
 *   node scripts/qa/dinero.mjs [--servicios 12] [--semilla 123]
 *
 * La semilla fija el azar: con la misma se repite exactamente el mismo recorrido.
 */
import { execSync } from 'node:child_process';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const CLAVE = process.env.CLAVE_DEMO ?? 'Demo-Local-2026!';
const DB = process.env.DB_CONTAINER ?? 'colombia-sexys-local-db-1';
const PAUSA_MS = Number(process.env.PAUSA_MS ?? 320);

const arg = (nombre, porDefecto) => {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : porDefecto;
};
const N = Number(arg('--servicios', 12));
const SEMILLA = Number(arg('--semilla', Date.now() % 100000));

// ---------------------------------------------------------------- azar fijo
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(SEMILLA);
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
const entre = (a, b) => a + azar() * (b - a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const id = (n) => `deadbeef-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------------------------------------------------------------- sesiones
class Sesion {
  constructor(nombre) {
    this.nombre = nombre;
    this.cookies = new Map();
  }

  async entrar(correo) {
    const r = await this.pedir('POST', '/auth/login', { email: correo, password: CLAVE });
    if (r.status !== 200) throw new Error(`login de ${correo}: ${r.status} ${JSON.stringify(r.json)}`);
  }

  async pedir(metodo, ruta, cuerpo) {
    const cabeceras = { 'content-type': 'application/json' };
    if (this.cookies.size) {
      cabeceras.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const csrf = this.cookies.get('csrf_token');
    if (csrf && metodo !== 'GET') cabeceras['x-csrf-token'] = csrf;
    const res = await fetch(API + ruta, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    for (const linea of res.headers.getSetCookie?.() ?? []) {
      const [par] = linea.split(';');
      const i = par.indexOf('=');
      this.cookies.set(par.slice(0, i), par.slice(i + 1));
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* sin cuerpo */
    }
    await dormir(PAUSA_MS); // cada sesion tiene su propio limite por minuto
    return { status: res.status, json };
  }
}

const sql = (consulta) =>
  execSync(
    `docker exec -i ${DB} psql -U colombia_sexys -d colombia_sexys -At`,
    { input: consulta, encoding: 'utf8' },
  ).trim();

// ---------------------------------------------------------------- resultados
let fallos = 0;
const bien = (texto) => console.log(`  ok   ${texto}`);
const mal = (texto) => {
  fallos += 1;
  console.log(`  FALLA ${texto}`);
};
const exigir = (condicion, texto) => (condicion ? bien(texto) : mal(texto));

// ---------------------------------------------------------------- semana (hora de Mexico, UTC-6)
function semanaActual() {
  const ahora = new Date(Date.now() - 6 * 3600_000);
  const dia = (ahora.getUTCDay() + 6) % 7; // lunes = 0
  const lunes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() - dia));
  const domingo = new Date(lunes.getTime() + 6 * 86400_000);
  const siguiente = new Date(lunes.getTime() + 7 * 86400_000);
  const f = (d) => d.toISOString().slice(0, 10);
  return {
    lunes: f(lunes),
    domingo: f(domingo),
    inicio: `${f(lunes)}T06:00:00.000Z`,
    fin: `${f(siguiente)}T05:59:59.999Z`,
  };
}

// ---------------------------------------------------------------- preparacion
const S = {};
async function preparar() {
  S.admin = new Sesion('admin');
  S.jefe = new Sesion('jefe');
  S.chofer = new Sesion('chofer');
  S.chofer2 = new Sesion('chofer2');
  S.emp = { [id(20)]: new Sesion('valentina'), [id(21)]: new Sesion('camila'), [id(22)]: new Sesion('salome') };
  await S.admin.entrar('demo.admin@ejemplo.local');
  await S.jefe.entrar('demo.jefe1@ejemplo.local');
  await S.chofer.entrar('demo.chofer1@ejemplo.local');
  await S.chofer2.entrar('demo.chofer2@ejemplo.local');
  await S.emp[id(20)].entrar('demo.modelo1@ejemplo.local');
  await S.emp[id(21)].entrar('demo.modelo2@ejemplo.local');
  await S.emp[id(22)].entrar('demo.modelo3@ejemplo.local');

  // Lugares predefinidos (moteles) con sus coordenadas, como los manda el formulario.
  const lugares = await S.admin.pedir('GET', '/transport-operations/configuration');
  S.lugares = (lugares.json?.locations ?? []).filter((l) => l.active);

  // Con el cargo de transporte en cero no se mueve dinero de transporte: ni se
  // cobra al cliente ni se le paga al chofer. Se fija uno para que la prueba lo
  // recorra de punta a punta.
  const configuracion = await S.admin.pedir('PATCH', '/transport-operations/configuration', {
    externalLocationFee: 180,
  });
  if (configuracion.status >= 400) {
    throw new Error(`no se pudo fijar el cargo de transporte: ${configuracion.status}`);
  }

  // La siembra deja a un chofer con un viaje activo y turnos que lo sacan del
  // reparto: se libera para que el despacho pueda ofrecerle los viajes.
  sql(`UPDATE viajes SET estado = 'cancelado'
        WHERE id::text LIKE 'deadbeef-%' AND estado IN ('aceptado','llegado','en_curso','notificado');
       DELETE FROM driver_shift_assignments;
       UPDATE choferes SET disponible = true, rechazos_consecutivos = 0;
       UPDATE servicios SET estado = 'cancelado', estado_operativo = 'cancelado'
        WHERE id::text LIKE 'deadbeef-%' AND estado IN ('en_curso', 'pendiente', 'agendado');`);
}

async function ubicaciones() {
  await S.chofer.pedir('POST', '/driver-portal/location', { lat: 20.5901, lng: -100.3877 });
  await S.chofer2.pedir('POST', '/driver-portal/location', { lat: 20.6102, lng: -100.4203 });
}

/** El despacho ofrece el viaje al chofer mas cercano: acepta quien lo recibio. */
async function viajeDelChofer(tripId) {
  await ubicaciones();
  let quien = null;
  for (const sesion of [S.chofer, S.chofer2]) {
    const r = await sesion.pedir('POST', `/driver-portal/trips/${tripId}/accept`, {});
    if (r.status === 200 && r.json?.aceptado) {
      quien = sesion;
      break;
    }
  }
  if (!quien) throw new Error(`ningun chofer pudo aceptar el viaje ${tripId}`);
  for (const paso of ['arrived', 'picked-up', 'finished']) {
    const r = await quien.pedir('POST', `/driver-portal/trips/${tripId}/${paso}`, {});
    if (r.status >= 400) throw new Error(`viaje ${tripId} ${paso}: ${r.status} ${JSON.stringify(r.json)}`);
  }
}

const PRECIOS = [1200, 1500, 1800, 2000, 2500, 1333.33, 1666.67, 1750.5];
const EXTRAS_TARJETA = [350.5, 999.99, 1000, 1234.56, 2500, 3333.33, 1999.99];

async function servicioCompleto(i) {
  const empleadaId = elegir([id(20), id(21), id(22)]);
  const metodo = elegir(['efectivo', 'tarjeta', 'transferencia']);
  const horas = elegir([1, 1.5, 2, 2.5, 3]);
  const precio = elegir(PRECIOS);
  const emp = S.emp[empleadaId];
  const etiqueta = `#${i + 1} ${metodo} ${horas}h x ${precio}`;

  const crear = await S.jefe.pedir('POST', '/services', {
    empleadaId,
    clienteNombreLibre: `Cliente QA ${SEMILLA}-${i}`,
    metodoPago: metodo,
    duracionPactadaHoras: horas,
    precioBaseHoraPactado: precio,
    // Un lugar predefinido (motel) es lo que mueve dinero de choferes en este
    // flujo: pago fijo por viaje. A domicilio, sin cargo cotizado, el chofer cobra 0.
    ...(S.lugares.length && azar() < 0.5
      ? (() => {
          const lugar = elegir(S.lugares);
          return {
            presetLocationId: lugar.id,
            ubicacionClienteLat: Number(lugar.latitude),
            ubicacionClienteLng: Number(lugar.longitude),
          };
        })()
      : {
          ubicacionClienteLat: 20.5888 + entre(-0.06, 0.06),
          ubicacionClienteLng: -100.3899 + entre(-0.06, 0.06),
        }),
    notas: 'QA dinero',
  });
  if (crear.status !== 201) {
    mal(`${etiqueta}: no se pudo crear (${crear.status} ${JSON.stringify(crear.json)})`);
    return null;
  }
  const servicioId = crear.json.id;

  if (azar() < 0.15) {
    await S.jefe.pedir('POST', `/services/${servicioId}/aceptar`, { transportType: 'chofer' });
    await emp.pedir('POST', `/employee-portal/services/${servicioId}/accept`, {});
    const c = await S.jefe.pedir('POST', `/services/${servicioId}/cancel`, { reason: 'cliente_desistio' });
    exigir(c.status === 201, `${etiqueta}: cancelado`);
    return servicioId;
  }

  await S.jefe.pedir('POST', `/services/${servicioId}/aceptar`, { transportType: 'chofer' });
  await emp.pedir('POST', `/employee-portal/services/${servicioId}/accept`, {});
  await ubicaciones();
  const ida = await S.jefe.pedir('POST', `/services/${servicioId}/internal-transport`, {});
  if (ida.status !== 201) {
    mal(`${etiqueta}: transporte de ida ${ida.status} ${JSON.stringify(ida.json)}`);
    return servicioId;
  }
  await viajeDelChofer(ida.json.id);
  await emp.pedir('POST', `/employee-portal/services/${servicioId}/start`, {});

  const disponibles = await emp.pedir('GET', `/employee-portal/services/${servicioId}/available-extras`);
  const catalogo = Array.isArray(disponibles.json) ? disponibles.json : [];
  const cuantos = catalogo.length ? Math.floor(azar() * 4) : 0;
  for (let k = 0; k < cuantos; k += 1) {
    await emp.pedir('POST', `/employee-portal/services/${servicioId}/extras`, {
      extraCatalogoId: elegir(catalogo).id,
      precioCobrado: elegir(EXTRAS_TARJETA),
      metodoPago: 'tarjeta',
    });
  }
  if (azar() < 0.3) {
    await emp.pedir('POST', `/employee-portal/services/${servicioId}/extend`, { horas: 1 });
  }
  const fin = await emp.pedir('POST', `/employee-portal/services/${servicioId}/finish`, {});
  if (fin.status !== 200) {
    mal(`${etiqueta}: terminar ${fin.status} ${JSON.stringify(fin.json)}`);
    return servicioId;
  }
  await ubicaciones();
  const regreso = await S.jefe.pedir('POST', `/services/${servicioId}/return-transport`, { transportType: 'chofer' });
  const idRegreso = regreso.json?.trip?.id ?? regreso.json?.id;
  if (regreso.status === 201 && idRegreso) await viajeDelChofer(idRegreso);
  else mal(`${etiqueta}: transporte de regreso ${regreso.status} ${JSON.stringify(regreso.json)}`);
  bien(`${etiqueta}: servicio completo`);
  return servicioId;
}

// ---------------------------------------------------------------- conciliacion
async function conciliar(titulo, esperado = []) {
  const semana = semanaActual();
  const r = await S.admin.pedir('GET', `/liquidations/conciliacion?from=${semana.lunes}&to=${semana.domingo}`);
  if (r.status !== 200) {
    mal(`${titulo}: la conciliacion respondio ${r.status} ${JSON.stringify(r.json)}`);
    return null;
  }
  const raras = r.json.verificaciones.filter((v) => v.estado !== 'ok' && !esperado.includes(v.id));
  if (raras.length === 0) {
    bien(`${titulo}: ${r.json.verificaciones.length} verificaciones, 0 discrepancias`);
  } else {
    mal(`${titulo}: ${raras.length} verificaciones con discrepancias`);
    for (const v of raras) {
      console.log(`         - ${v.id}: ${v.casos} casos, diferencia ${v.diferenciaTotal}`);
      for (const c of v.muestra.slice(0, 3)) {
        console.log(`             ${c.referencia}: esperado ${c.esperado}, real ${c.real} (${c.detalle})`);
      }
    }
  }
  return r.json;
}

// ---------------------------------------------------------------- fases
async function faseServicios() {
  console.log(`\n== Fase 1. ${N} servicios completos por la API`);
  const ids = [];
  for (let i = 0; i < N; i += 1) {
    try {
      const servicio = await servicioCompleto(i);
      if (servicio) ids.push(servicio);
    } catch (error) {
      mal(`servicio #${i + 1}: ${error.message}`);
    }
  }
  return ids;
}

async function faseEfectivo() {
  console.log('\n== Fase 2. Abonos de efectivo');
  for (const empleadaId of [id(20), id(21), id(22)]) {
    const r = await S.jefe.pedir('GET', `/transport-operations/cash-obligations?employeeId=${empleadaId}`);
    const abiertas = (r.json?.obligations ?? []).filter((o) => o.status !== 'paid' && o.calculationStatus === 'ready');
    const pendiente = abiertas.reduce((s, o) => s + Math.round((o.amount - o.paidAmount) * 100), 0);
    if (pendiente <= 0) continue;
    // Un abono parcial con centavos y despues el resto exacto.
    const parcial = Math.max(1, Math.floor(pendiente * (0.2 + azar() * 0.5)));
    const a = await S.jefe.pedir('POST', '/transport-operations/cash-payments', {
      employeeId: empleadaId,
      amount: parcial / 100,
      note: 'QA abono parcial',
    });
    exigir(a.status === 201, `abono parcial de ${parcial / 100} a ${empleadaId.slice(-2)}`);
    const resto = pendiente - parcial;
    if (resto > 0) {
      const b = await S.jefe.pedir('POST', '/transport-operations/cash-payments', {
        employeeId: empleadaId,
        amount: resto / 100,
        note: 'QA resto exacto',
      });
      exigir(b.status === 201, `resto exacto de ${resto / 100}`);
      const c = await S.jefe.pedir('POST', '/transport-operations/cash-payments', {
        employeeId: empleadaId,
        amount: 0.01,
        note: 'QA un centavo de mas',
      });
      exigir(c.status === 400 || c.status === 409, `un centavo de mas se rechaza (${c.status})`);
    }
  }
}

async function faseMultas() {
  console.log('\n== Fase 3. Multas y reversiones');
  const empleada = id(22);
  const crear = async (razon, monto) =>
    S.admin.pedir('POST', '/discipline/sanctions', {
      subjectType: 'employee',
      subjectId: empleada,
      type: 'fine',
      reason: razon,
      fineAmount: monto,
    });
  const a = await crear('Retardo QA', 300);
  const b = await crear('Retardo QA grave', 300);
  exigir(a.status === 201 && b.status === 201, 'dos multas iguales de la misma empleada');
  const antes = sql(`SELECT count(*) FROM liquidation_records WHERE employee_id = '${empleada}' AND is_fine AND fine_amount = 300 AND place LIKE 'Multa: Retardo QA%'`);
  exigir(antes === '2', `dos registros de multa en el corte (hay ${antes})`);

  const rev = await S.admin.pedir('POST', `/discipline/sanctions/${a.json.id}/revoke`, { reason: 'QA se revoca la primera' });
  exigir(rev.status === 201 || rev.status === 200, 'se revoca solo la primera');
  const despues = sql(`SELECT count(*) FROM liquidation_records WHERE employee_id = '${empleada}' AND is_fine AND fine_amount = 300 AND place LIKE 'Multa: Retardo QA%'`);
  exigir(despues === '1', `la otra multa sigue descontando (quedan ${despues}, antes borraba las dos)`);
  await conciliar('despues de revocar una de dos multas iguales');

  // Una multa dentro de una semana ya confirmada no reescribe el pasado.
  const c = await crear('Multa de semana cerrada QA', 450);
  exigir(c.status === 201, 'multa que va a quedar dentro de un corte confirmado');
  return { multaCerrada: c.json?.id };
}

async function faseCortes(extra) {
  console.log('\n== Fase 4. Cortes semanales');
  const semana = semanaActual();
  for (const empleadaId of [id(20), id(21), id(22)]) {
    const r = await S.admin.pedir('POST', '/liquidations/weekly-settlements/confirm', {
      startDate: semana.inicio,
      endDate: semana.fin,
      employeeId: empleadaId,
    });
    exigir([200, 201, 409].includes(r.status), `corte confirmado de ${empleadaId.slice(-2)} (${r.status})`);
  }
  const fila = sql(`SELECT string_agg(week_start || ' a ' || week_end, ', ') FROM employee_weekly_settlements WHERE week_start = '${semana.lunes}'`);
  exigir(fila.includes(`${semana.lunes} a ${semana.domingo}`), `el corte guarda el domingo como fin de semana (${fila.split(',')[0]})`);
  await conciliar('despues de confirmar los cortes');

  if (extra?.multaCerrada) {
    const rev = await S.admin.pedir('POST', `/discipline/sanctions/${extra.multaCerrada}/revoke`, { reason: 'QA revocar con el corte cerrado' });
    exigir(rev.status === 201 || rev.status === 200, 'se revoca una multa de una semana ya confirmada');
    const reversas = sql(`SELECT count(*) FROM liquidation_records WHERE is_fine AND fine_amount < 0 AND place LIKE 'Reversa de multa%'`);
    exigir(Number(reversas) >= 1, `quedo una reversa negativa en la semana abierta (${reversas})`);
    await conciliar('despues de revocar una multa con el corte cerrado');
  }
}

async function faseChoferes() {
  console.log('\n== Fase 5. Cortes de choferes');
  const semana = semanaActual();
  // Multa a un chofer: debe descontarse de su pago, no quedar solo registrada.
  sql(`INSERT INTO disciplinary_sanctions (subject_type, subject_id, type, fine_amount, status, reason, created_by_user_id)
       SELECT 'driver', c.id, 'fine', 40, 'active', 'Multa de prueba QA', c.usuario_id FROM choferes c WHERE c.id = '${id(30)}'`);
  const r = await S.admin.pedir('POST', `/transport-operations/driver-settlements/${id(30)}/pay`, {
    startDate: semana.lunes,
    endDate: semana.domingo,
  });
  exigir([200, 201, 400, 409].includes(r.status), `corte del chofer (${r.status})`);
  await conciliar('despues de pagar el corte del chofer');

  // Las multas del chofer se descuentan de su pago, y un viaje que termina con el
  // corte de su semana ya pagado se paga en la semana siguiente.
  const pagado = sql(`SELECT id || '|' || total FROM driver_settlements WHERE driver_id = '${id(30)}' AND week_start = '${semana.lunes}' AND status = 'paid'`);
  if (pagado) {
    const [corteId, total] = pagado.split('|');
    const suma = sql(`SELECT COALESCE(SUM(driver_payout),0) FROM viajes WHERE driver_settlement_id = '${corteId}'`);
    const multas = sql(`SELECT COALESCE(SUM(fine_amount),0) FROM disciplinary_sanctions WHERE driver_settlement_id = '${corteId}'`);
    exigir(Math.abs(Number(total) - (Number(suma) - Number(multas))) < 0.005, `corte pagado: viajes ${suma} menos multas ${multas} = ${total}`);
  }
  // Servicios que terminan con los cortes de las empleadas ya confirmados: entran
  // en la semana siguiente, sin tocar la pagada.
  for (let intento = 0; intento < 3; intento += 1) await servicioCompleto(N + 1000 + intento);
  const lunesSiguiente = sql(`SELECT ('${semana.lunes}'::date + 7)::text`);
  const tardios = sql(`SELECT count(*) FROM servicios WHERE estado = 'finalizado' AND hora_fin_servicio > (SELECT max(confirmed_at) FROM employee_weekly_settlements)`);
  const movidos = sql(`SELECT count(*) FROM liquidation_records WHERE NOT is_fine AND NOT cancelled AND occurred_at >= '${lunesSiguiente} 00:00-06'`);
  exigir(Number(movidos) === Number(tardios), `los ${tardios} servicios tardios entran en la semana siguiente (${movidos} registros)`);
  await conciliar('despues de un viaje que termina con el corte ya pagado');
  const sinCorte = sql(`SELECT count(*) FROM viajes WHERE chofer_id = '${id(30)}' AND estado = 'finalizado' AND driver_settlement_id IS NULL AND hora_fin_viaje >= '${semana.lunes} 00:00-06'`);
  const posteriores = sql(`SELECT count(*) FROM driver_settlements WHERE driver_id = '${id(30)}' AND status = 'pending' AND week_start > '${semana.lunes}'`);
  console.log(`  viajes sin corte tras el pago: ${sinCorte}; cortes pendientes posteriores: ${posteriores}`);
}

async function main() {
  console.log(`Prueba de dinero. Semilla ${SEMILLA}, ${N} servicios.`);
  await preparar();
  const base = await conciliar('punto de partida');
  await faseServicios();
  await conciliar('despues de los servicios');
  await faseEfectivo();
  await conciliar('despues de los abonos de efectivo');
  const extra = await faseMultas();
  await faseCortes(extra);
  await faseChoferes();
  const final = await conciliar('estado final');

  if (final) {
    console.log('\n== Resumen del dinero de la semana');
    for (const [k, v] of Object.entries(final.resumen)) console.log(`   ${k}: ${v}`);
  }
  void base;
  console.log(fallos === 0 ? '\nTodo cuadra: 0 fallos.' : `\n${fallos} fallos.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(2);
});
