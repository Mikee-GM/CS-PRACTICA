import {
  calificacionDelCliente,
  MINIMO_DE_CALIFICACIONES,
  serviciosFinalizados,
  tieneSancionVigente,
} from './perfil-del-cliente';

function db(filas: unknown[]) {
  return { query: jest.fn().mockResolvedValue(filas) };
}

/** Normaliza espacios para comparar fragmentos de SQL sin depender del sangrado. */
function sql(mock: jest.Mock): string {
  return (mock.mock.calls[0] as [string])[0].replace(/\s+/g, ' ');
}

describe('calificacionDelCliente', () => {
  it('el minimo es de tres calificaciones', () => {
    expect(MINIMO_DE_CALIFICACIONES).toBe(3);
  });

  it('oculta el promedio con menos de tres notas pero devuelve la cantidad', async () => {
    for (const cantidad of [0, 1, 2]) {
      const conexion = db([
        { promedio: cantidad ? 2 : null, cantidad: cantidad },
      ]);
      await expect(
        calificacionDelCliente(conexion, 'cliente-1'),
      ).resolves.toEqual({ promedio: null, cantidad });
    }
  });

  it('devuelve el promedio con tres notas o mas', async () => {
    const conexion = db([{ promedio: 4.33, cantidad: 3 }]);
    await expect(
      calificacionDelCliente(conexion, 'cliente-1'),
    ).resolves.toEqual({ promedio: 4.33, cantidad: 3 });
  });

  it('sin filas responde cero notas y sin promedio', async () => {
    await expect(calificacionDelCliente(db([]), 'c')).resolves.toEqual({
      promedio: null,
      cantidad: 0,
    });
  });

  it('usa el criterio de ratingSummary: solo notas al cliente y sin apelaciones abiertas ni anuladas', async () => {
    const conexion = db([{ promedio: null, cantidad: 0 }]);
    await calificacionDelCliente(conexion, 'cliente-1');

    const consulta = sql(conexion.query);
    expect(consulta).toContain('ROUND(AVG(stars)::numeric, 2)');
    expect(consulta).toContain('COUNT(*)');
    expect(consulta).toContain('FROM interaction_ratings');
    expect(consulta).toContain('client_id = $1');
    expect(consulta).toContain("direction = 'employee_to_client'");
    expect(consulta).toContain(
      "appeal_status NOT IN ('pending', 'overturned')",
    );
    // Nada del detalle interno sale de la consulta.
    expect(consulta).not.toMatch(/comment|employee_id/);
    const [, parametros] = conexion.query.mock.calls[0] as [string, unknown[]];
    expect(parametros).toEqual(['cliente-1']);
  });
});

describe('serviciosFinalizados', () => {
  it('cuenta solo los finalizados del cliente que no estan borrados', async () => {
    const conexion = db([{ finalizados: 7 }]);
    await expect(serviciosFinalizados(conexion, 'cliente-1')).resolves.toBe(7);

    const consulta = sql(conexion.query);
    expect(consulta).toContain("FILTER (WHERE estado = 'finalizado')");
    expect(consulta).toContain('FROM servicios');
    expect(consulta).toContain('cliente_id = $1 AND deleted_at IS NULL');
  });
});

describe('tieneSancionVigente', () => {
  it('lee la sancion del cliente con las condiciones de getActiveSanction', async () => {
    const conexion = db([{ vigente: true }]);
    await expect(tieneSancionVigente(conexion, 'cliente-1')).resolves.toBe(
      true,
    );

    const consulta = sql(conexion.query);
    expect(consulta).toContain("subject_type = 'client'");
    expect(consulta).toContain("status = 'active'");
    expect(consulta).toContain('starts_at <= now()');
    expect(consulta).toContain("type = 'permanent_ban'");
    expect(consulta).toContain("type = 'suspension' AND ends_at > now()");
    // Es una lectura: no puede expirar sanciones como hace getActiveSanction.
    expect(consulta).not.toMatch(/UPDATE|reason/i);
  });

  it('sin sancion responde false', async () => {
    await expect(
      tieneSancionVigente(db([{ vigente: false }]), 'c'),
    ).resolves.toBe(false);
  });
});
