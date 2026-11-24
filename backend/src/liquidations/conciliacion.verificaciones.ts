/**
 * Verificaciones de la conciliacion de dinero.
 *
 * Cada una recalcula con SQL propio, a partir de los servicios, un importe que el
 * sistema guarda en otra parte (registros de liquidacion, obligaciones de
 * efectivo, cortes de choferes...) y devuelve las filas donde no coinciden. No
 * reutilizan el codigo que calcula esos importes: una comprobacion que usa la
 * misma funcion que quiere vigilar solo confirma que se equivoca igual.
 *
 * Todas reciben dos parametros: `$1` inicio y `$2` fin (exclusivo) del periodo,
 * como instantes. Y devuelven las columnas:
 *   referencia, servicio_id, esperado, real, detalle
 * Una fila devuelta es una discrepancia; ninguna fila es "todo cuadra".
 */

export type DefinicionDeVerificacion = {
  id: string;
  titulo: string;
  descripcion: string;
  sql: string;
};

/** Servicios terminados dentro del periodo. */
const SERVICIOS_DEL_PERIODO = `
  s.estado = 'finalizado'
  AND s.hora_fin_servicio >= $1 AND s.hora_fin_servicio < $2
`;

/** Lo que cuestan los Uber ya confirmados de un servicio. */
const COSTO_UBER = `
  COALESCE((
    SELECT SUM(v.tarifa) FROM viajes v
    WHERE v.servicio_id = s.id
      AND v.proveedor_transporte = 'uber'
      AND v.estado NOT IN ('cancelado', 'rechazado')
      AND v.fare_confirmed_at IS NOT NULL
  ), 0)`;

/** Efectivo que la empleada le debe a la empresa por un servicio en efectivo. */
const EFECTIVO_DEBIDO = `
  CASE WHEN s.metodo_pago = 'efectivo'
    THEN GREATEST(0, s.total_final - ${COSTO_UBER})
    ELSE 0 END`;

/** Un servicio individual con empleada y un responsable que registra cortes. */
const REGISTRA_CORTE = `
  s.service_type = 'individual'
  AND s.empleada_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = s.jefe_id AND u.rol IN ('admin', 'jefe')
  )
`;

const TOLERANCIA = '0.004';

/**
 * Nombra por posicion las cinco columnas que devuelve cada verificacion, para que
 * ninguna tenga que repetir los alias. La usan el servicio y la prueba contra la
 * base real, de modo que prueban exactamente la misma consulta.
 */
export function consultaDeVerificacion(sql: string): string {
  return `SELECT * FROM (${sql}) AS t(referencia, servicio_id, esperado, real, detalle)`;
}

export const VERIFICACIONES: DefinicionDeVerificacion[] = [
  {
    id: 'total-del-servicio',
    titulo: 'Total del servicio igual a base, extras y transporte',
    descripcion:
      'El total que se cobra al cliente tiene que ser exactamente la suma de sus tres partes.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8) AS referencia, s.id AS servicio_id,
             (s.total_base + COALESCE(s.total_extras, 0) + COALESCE(s.total_transporte, 0)) AS esperado,
             s.total_final AS real,
             'base ' || s.total_base || ' + extras ' || COALESCE(s.total_extras, 0)
               || ' + transporte ' || COALESCE(s.total_transporte, 0) AS detalle
      FROM servicios s
      WHERE ${SERVICIOS_DEL_PERIODO}
        AND abs(s.total_final - (s.total_base + COALESCE(s.total_extras, 0) + COALESCE(s.total_transporte, 0))) > ${TOLERANCIA}`,
  },
  {
    id: 'base-del-servicio',
    titulo: 'Base del servicio igual a horas por precio',
    descripcion:
      'En un servicio individual la base es la duracion pactada por el precio por hora.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id,
             round(s.duracion_pactada_horas * s.precio_base_hora_pactado, 2),
             s.total_base,
             s.duracion_pactada_horas || ' h x ' || s.precio_base_hora_pactado
      FROM servicios s
      WHERE ${SERVICIOS_DEL_PERIODO} AND s.service_type = 'individual'
        AND abs(s.total_base - round(s.duracion_pactada_horas * s.precio_base_hora_pactado, 2)) > ${TOLERANCIA}`,
  },
  {
    id: 'extras-del-servicio',
    titulo: 'Extras del servicio igual a la suma de sus extras',
    descripcion: 'El total de extras tiene que ser la suma de cada extra cobrado.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id,
             COALESCE((SELECT SUM(e.precio_cobrado) FROM extras_servicio e WHERE e.servicio_id = s.id), 0),
             COALESCE(s.total_extras, 0),
             'suma de extras contra total_extras del servicio'
      FROM servicios s
      WHERE ${SERVICIOS_DEL_PERIODO}
        AND abs(COALESCE(s.total_extras, 0)
              - COALESCE((SELECT SUM(e.precio_cobrado) FROM extras_servicio e WHERE e.servicio_id = s.id), 0)) > ${TOLERANCIA}`,
  },
  {
    id: 'pagos-del-servicio',
    titulo: 'Pagado igual a la suma de pagos aprobados',
    descripcion: 'Lo que el servicio dice haber cobrado tiene que ser la suma de sus pagos aprobados.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id,
             COALESCE((SELECT SUM(p.amount) FROM service_payments p WHERE p.service_id = s.id AND p.status = 'aprobado'), 0),
             COALESCE(s.total_paid, 0),
             'pagos aprobados contra total_paid'
      FROM servicios s
      WHERE ${SERVICIOS_DEL_PERIODO}
        AND abs(COALESCE(s.total_paid, 0)
              - COALESCE((SELECT SUM(p.amount) FROM service_payments p WHERE p.service_id = s.id AND p.status = 'aprobado'), 0)) > ${TOLERANCIA}`,
  },
  {
    id: 'comision-extras-tarjeta',
    titulo: 'Comision de los extras con tarjeta',
    descripcion:
      'La empresa retiene el 15 % de un extra pagado con tarjeta cuando llega a 1.000; en cualquier otro caso, nada.',
    sql: `
      SELECT 'extra ' || left(e.id::text, 8), e.servicio_id,
             CASE WHEN e.metodo_pago::text = 'tarjeta' AND e.precio_cobrado >= 1000
                  THEN round(e.precio_cobrado * 0.15, 2) ELSE 0 END,
             e.company_commission_snapshot,
             e.metodo_pago::text || ' de ' || e.precio_cobrado
      FROM extras_servicio e
      JOIN servicios s ON s.id = e.servicio_id
      WHERE ${SERVICIOS_DEL_PERIODO}
        AND e.financial_snapshot_status = 'captured'
        AND abs(e.company_commission_snapshot
              - CASE WHEN e.metodo_pago::text = 'tarjeta' AND e.precio_cobrado >= 1000
                     THEN round(e.precio_cobrado * 0.15, 2) ELSE 0 END) > ${TOLERANCIA}`,
  },
  {
    id: 'neto-extras-empleada',
    titulo: 'Neto de la empleada en cada extra',
    descripcion: 'Lo que le queda a la empleada de un extra es el importe menos la comision.',
    sql: `
      SELECT 'extra ' || left(e.id::text, 8), e.servicio_id,
             e.precio_cobrado - e.company_commission_snapshot,
             e.employee_net_snapshot,
             'importe ' || e.precio_cobrado || ' - comision ' || e.company_commission_snapshot
      FROM extras_servicio e
      JOIN servicios s ON s.id = e.servicio_id
      WHERE ${SERVICIOS_DEL_PERIODO}
        AND e.financial_snapshot_status = 'captured'
        AND abs(e.employee_net_snapshot - (e.precio_cobrado - e.company_commission_snapshot)) > ${TOLERANCIA}`,
  },
  {
    id: 'servicio-sin-registro',
    titulo: 'Servicios terminados sin registro de liquidacion',
    descripcion:
      'Cada servicio terminado tiene que aparecer en el corte de su empleada; si falta, ese dinero no se liquida.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id, s.total_base, 0::numeric,
             'no hay registro de liquidacion para este servicio'
      FROM servicios s
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE}
        AND NOT EXISTS (
          SELECT 1 FROM liquidation_records r
          WHERE r.service_id = s.id AND NOT r.is_fine AND NOT r.cancelled)`,
  },
  {
    id: 'registro-duplicado',
    titulo: 'Servicios con mas de un registro de liquidacion',
    descripcion: 'Un registro repetido cuenta dos veces el mismo servicio en el corte.',
    sql: `
      SELECT 'servicio ' || left(r.service_id::text, 8), r.service_id, 1::numeric, count(*)::numeric,
             count(*) || ' registros de la misma empleada para un servicio'
      FROM liquidation_records r
      WHERE r.service_id IS NOT NULL AND NOT r.is_fine
        AND r.occurred_at >= $1 AND r.occurred_at < $2
      GROUP BY r.service_id, r.employee_id
      HAVING count(*) > 1`,
  },
  {
    id: 'registro-base',
    titulo: 'Registro de liquidacion: base del servicio',
    descripcion: 'El importe del servicio en el corte tiene que ser el del servicio.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id, s.total_base, r.service_total,
             'el registro quedo con otro importe que el servicio'
      FROM servicios s
      JOIN liquidation_records r ON r.service_id = s.id AND r.employee_id = s.empleada_id AND NOT r.is_fine AND NOT r.cancelled
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE}
        AND abs(r.service_total - s.total_base) > ${TOLERANCIA}`,
  },
  {
    id: 'registro-extras',
    titulo: 'Registro de liquidacion: extras',
    descripcion: 'Los extras del corte tienen que ser los extras del servicio.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id, COALESCE(s.total_extras, 0), r.extra_amount,
             'el registro quedo con otros extras que el servicio'
      FROM servicios s
      JOIN liquidation_records r ON r.service_id = s.id AND r.employee_id = s.empleada_id AND NOT r.is_fine AND NOT r.cancelled
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE}
        AND abs(r.extra_amount - COALESCE(s.total_extras, 0)) > ${TOLERANCIA}`,
  },
  {
    id: 'registro-transporte-cliente',
    titulo: 'Registro de liquidacion: transporte cobrado al cliente',
    descripcion: 'Lo que se cobro al cliente por transporte tiene que coincidir con el servicio.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id,
             COALESCE(s.customer_transport_charge, s.total_transporte, 0), r.customer_transport_charge,
             'el registro quedo con otro cargo de transporte que el servicio'
      FROM servicios s
      JOIN liquidation_records r ON r.service_id = s.id AND r.employee_id = s.empleada_id AND NOT r.is_fine AND NOT r.cancelled
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE}
        AND abs(r.customer_transport_charge - COALESCE(s.customer_transport_charge, s.total_transporte, 0)) > ${TOLERANCIA}`,
  },
  {
    id: 'registro-efectivo-debido',
    titulo: 'Registro de liquidacion: efectivo que debe la empleada',
    descripcion:
      'El efectivo que la empleada tiene que entregar es el total cobrado en efectivo menos los Uber que ella adelanto.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id, ${EFECTIVO_DEBIDO}, r.employee_cash_due,
             s.metodo_pago::text || ', total ' || s.total_final
      FROM servicios s
      JOIN liquidation_records r ON r.service_id = s.id AND r.employee_id = s.empleada_id AND NOT r.is_fine AND NOT r.cancelled
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE}
        AND abs(r.employee_cash_due - (${EFECTIVO_DEBIDO})) > ${TOLERANCIA}`,
  },
  {
    id: 'reparto-servicio',
    titulo: 'Reparto del servicio: empresa mas empleada igual al total',
    descripcion:
      'Lo que se queda la empresa y lo que se lleva la empleada, redondeados por separado, tienen que sumar el servicio sin perder ni sobrar un centavo.',
    sql: `
      SELECT 'registro ' || left(r.id::text, 8), r.service_id,
             r.service_total + CASE WHEN r.promotion THEN 300 ELSE 0 END,
             round((r.service_total + CASE WHEN r.promotion THEN 300 ELSE 0 END) * r.company_percentage / 100, 2)
               + round(r.service_total * (100 - r.company_percentage) / 100, 2),
             'empresa ' || r.company_percentage || ' % / empleada ' || (100 - r.company_percentage) || ' %'
      FROM liquidation_records r
      WHERE NOT r.is_fine AND NOT r.cancelled AND NOT r.excluded_from_cut
        AND r.occurred_at >= $1 AND r.occurred_at < $2
        AND abs((r.service_total + CASE WHEN r.promotion THEN 300 ELSE 0 END)
              - (round((r.service_total + CASE WHEN r.promotion THEN 300 ELSE 0 END) * r.company_percentage / 100, 2)
                 + round(r.service_total * (100 - r.company_percentage) / 100, 2))) > ${TOLERANCIA}`,
  },
  {
    id: 'obligacion-efectivo-faltante',
    titulo: 'Servicios en efectivo sin obligacion de efectivo',
    descripcion: 'Si la empleada cobro en efectivo, tiene que existir lo que debe entregar.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id, ${EFECTIVO_DEBIDO}, 0::numeric,
             'no existe la obligacion de efectivo'
      FROM servicios s
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE} AND s.metodo_pago = 'efectivo'
        AND NOT EXISTS (SELECT 1 FROM employee_cash_obligations o WHERE o.service_id = s.id)`,
  },
  {
    id: 'obligacion-efectivo-importe',
    titulo: 'Importe de la obligacion de efectivo',
    descripcion: 'La obligacion de efectivo tiene que ser lo que la empleada cobro menos los Uber que adelanto.',
    sql: `
      SELECT 'servicio ' || left(s.id::text, 8), s.id, ${EFECTIVO_DEBIDO}, o.amount,
             'obligacion ' || left(o.id::text, 8) || ' (' || o.status || ')'
      FROM servicios s
      JOIN employee_cash_obligations o ON o.service_id = s.id
      WHERE ${SERVICIOS_DEL_PERIODO} AND ${REGISTRA_CORTE} AND s.metodo_pago = 'efectivo'
        AND abs(o.amount - (${EFECTIVO_DEBIDO})) > ${TOLERANCIA}`,
  },
  {
    id: 'obligacion-abonos',
    titulo: 'Obligaciones: pagado igual a lo repartido en abonos',
    descripcion: 'Lo que una obligacion dice tener pagado tiene que ser la suma de los abonos que se le asignaron.',
    sql: `
      SELECT 'obligacion ' || left(o.id::text, 8), o.service_id, o.paid_amount,
             COALESCE((SELECT SUM(a.amount) FROM employee_cash_payment_allocations a
                       JOIN employee_cash_payments p ON p.id = a.payment_id
                       WHERE a.obligation_id = o.id AND p.reverted_at IS NULL), 0),
             'pagado contra asignaciones de abonos vigentes'
      FROM employee_cash_obligations o
      WHERE o.service_date >= $1 AND o.service_date < $2
        AND abs(o.paid_amount - COALESCE((SELECT SUM(a.amount) FROM employee_cash_payment_allocations a
                       JOIN employee_cash_payments p ON p.id = a.payment_id
                       WHERE a.obligation_id = o.id AND p.reverted_at IS NULL), 0)) > ${TOLERANCIA}`,
  },
  {
    id: 'obligacion-estado',
    titulo: 'Obligaciones: estado coherente con lo pagado',
    descripcion: 'Una obligacion esta pagada si y solo si lo pagado alcanza su importe, y nunca se paga de mas.',
    sql: `
      SELECT 'obligacion ' || left(o.id::text, 8), o.service_id, o.amount, o.paid_amount,
             'estado ' || o.status || ', pagado ' || o.paid_amount || ' de ' || o.amount
      FROM employee_cash_obligations o
      WHERE o.service_date >= $1 AND o.service_date < $2
        AND (o.paid_amount > o.amount + ${TOLERANCIA}
          OR (o.paid_amount >= o.amount AND o.status <> 'paid')
          OR (o.paid_amount < o.amount AND o.status = 'paid'))`,
  },
  {
    id: 'abono-aplicado',
    titulo: 'Abonos de efectivo aplicados por completo',
    descripcion: 'Cada abono vigente tiene que estar repartido entre obligaciones: ni dinero sin aplicar ni aplicado de mas.',
    sql: `
      SELECT 'abono ' || left(p.id::text, 8), NULL::uuid, p.amount,
             COALESCE((SELECT SUM(a.amount) FROM employee_cash_payment_allocations a WHERE a.payment_id = p.id), 0),
             'origen ' || p.origin || ' de la empleada ' || left(p.employee_id::text, 8)
      FROM employee_cash_payments p
      WHERE p.reverted_at IS NULL AND p.created_at >= $1 AND p.created_at < $2
        AND abs(p.amount - COALESCE((SELECT SUM(a.amount) FROM employee_cash_payment_allocations a WHERE a.payment_id = p.id), 0)) > ${TOLERANCIA}`,
  },
  {
    id: 'corte-chofer',
    titulo: 'Cortes de choferes: total igual a la suma de sus viajes',
    descripcion:
      'Un corte pagado suma los viajes que liquido menos las multas que descontó; uno pendiente suma los viajes terminados que todavia no estan en ningun corte menos las multas por descontar.',
    sql: `
      SELECT 'corte ' || left(d.id::text, 8), NULL::uuid, d.total, x.suma - x.multas,
             d.status || ', semana ' || d.week_start || ' del chofer ' || left(d.driver_id::text, 8)
      FROM driver_settlements d
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(v.driver_payout), 0) AS suma,
               CASE WHEN d.status = 'paid'
                 THEN COALESCE((SELECT SUM(s.fine_amount) FROM disciplinary_sanctions s
                                 WHERE s.driver_settlement_id = d.id), 0)
                 ELSE COALESCE((SELECT SUM(s.fine_amount) FROM disciplinary_sanctions s
                                 WHERE s.subject_type = 'driver' AND s.subject_id = d.driver_id
                                   AND s.type = 'fine' AND s.status = 'active'
                                   AND s.driver_settlement_id IS NULL
                                   AND s.created_at < ((d.week_end + 1)::timestamp AT TIME ZONE 'America/Mexico_City')), 0)
               END AS multas
        FROM viajes v
        WHERE CASE WHEN d.status = 'paid'
                THEN v.driver_settlement_id = d.id
                ELSE v.chofer_id = d.driver_id
                 AND v.proveedor_transporte = 'interno'
                 AND v.estado = 'finalizado'
                 AND v.driver_settlement_id IS NULL
                 AND v.hora_fin_viaje < ((d.week_end + 1)::timestamp AT TIME ZONE 'America/Mexico_City')
                 AND (v.hora_fin_viaje >= (d.week_start::timestamp AT TIME ZONE 'America/Mexico_City')
                      OR EXISTS (SELECT 1 FROM driver_settlements p
                                  WHERE p.driver_id = d.driver_id AND p.status = 'paid'
                                    AND (v.hora_fin_viaje AT TIME ZONE 'America/Mexico_City')::date
                                        BETWEEN p.week_start AND p.week_end))
              END
      ) x
      WHERE d.week_start >= ($1 AT TIME ZONE 'America/Mexico_City')::date - 7
        AND d.week_start < ($2 AT TIME ZONE 'America/Mexico_City')::date
        -- Un corte pendiente con mas multas que viajes descuenta solo las que caben:
        -- no se puede recalcular sin repetir esa eleccion, asi que no se verifica.
        AND (d.status = 'paid' OR x.suma >= x.multas)
        AND abs(d.total - (x.suma - x.multas)) > ${TOLERANCIA}`,
  },
  {
    id: 'viaje-fuera-de-corte',
    titulo: 'Viajes de choferes sin un corte abierto que los recoja',
    descripcion:
      'Un viaje terminado despues de pagar el corte de su semana se paga en la semana siguiente: tiene que existir un corte pendiente posterior que lo recoja.',
    sql: `
      SELECT 'viaje ' || left(v.id::text, 8), v.servicio_id, v.driver_payout, 0::numeric,
             'terminado en la semana ' || d.week_start || ', ya pagada, y no hay un corte posterior abierto'
      FROM viajes v
      JOIN driver_settlements d
        ON d.driver_id = v.chofer_id AND d.status = 'paid'
       AND v.hora_fin_viaje >= (d.week_start::timestamp AT TIME ZONE 'America/Mexico_City')
       AND v.hora_fin_viaje < ((d.week_end + 1)::timestamp AT TIME ZONE 'America/Mexico_City')
      WHERE v.proveedor_transporte = 'interno' AND v.estado = 'finalizado'
        AND v.driver_payout > 0 AND v.driver_settlement_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM driver_settlements n
                         WHERE n.driver_id = v.chofer_id AND n.status = 'pending'
                           AND n.week_start > d.week_start)
        AND v.hora_fin_viaje >= $1::timestamptz - interval '21 days'
        AND v.hora_fin_viaje < $2`,
  },
  {
    id: 'corte-semanal-empleada',
    titulo: 'Cortes semanales confirmados: neto igual a bruto menos compensacion',
    descripcion: 'Lo que se le paga a la empleada es lo que gano menos el efectivo que se le compenso.',
    sql: `
      SELECT 'corte ' || left(w.id::text, 8), NULL::uuid, w.gross_employee_pay - w.cash_offset, w.net_employee_pay,
             'semana ' || w.week_start || ' de la empleada ' || left(w.employee_id::text, 8)
      FROM employee_weekly_settlements w
      WHERE w.week_start >= ($1 AT TIME ZONE 'America/Mexico_City')::date - 7
        AND w.week_start < ($2 AT TIME ZONE 'America/Mexico_City')::date
        AND abs(w.net_employee_pay - (w.gross_employee_pay - w.cash_offset)) > ${TOLERANCIA}`,
  },
  {
    id: 'deuda-pagos',
    titulo: 'Deudas del personal: pagos dentro del importe',
    descripcion: 'Lo abonado a una deuda nunca puede pasar de lo que se debia.',
    sql: `
      SELECT 'deuda ' || left(d.id::text, 8), NULL::uuid, d.amount,
             COALESCE((SELECT SUM(p.amount) FROM liquidation_payments p WHERE p.debt_id = d.id AND p.deleted_at IS NULL), 0),
             'estado ' || d.status
      FROM liquidation_debts d
      WHERE d.deleted_at IS NULL
        AND COALESCE((SELECT SUM(p.amount) FROM liquidation_payments p WHERE p.debt_id = d.id AND p.deleted_at IS NULL), 0) > d.amount + ${TOLERANCIA}`,
  },
  {
    id: 'multas-sancion',
    titulo: 'Multas: lo descontado en el corte es lo de la sancion',
    descripcion:
      'Una multa vigente se descuenta una sola vez y una revocada no descuenta nada, contando las reversas cuando el corte ya estaba cerrado.',
    sql: `
      SELECT 'sancion ' || left(x.id::text, 8), NULL::uuid, x.esperado, x.real,
             'multa de ' || x.fine_amount || ' (' || x.status || ')'
      FROM (
        SELECT sn.id, sn.fine_amount, sn.status,
               CASE WHEN sn.status = 'revoked' THEN 0 ELSE sn.fine_amount END AS esperado,
               COALESCE((SELECT SUM(r.fine_amount) FROM liquidation_records r
                         WHERE r.sanction_id = sn.id AND r.is_fine AND NOT r.excluded_from_cut), 0) AS real
        FROM disciplinary_sanctions sn
        WHERE sn.type = 'fine' AND sn.subject_type = 'employee'
          AND sn.created_at >= $1 AND sn.created_at < $2
      ) x
      WHERE abs(x.esperado - x.real) > ${TOLERANCIA}`,
  },
];
