import { ConversationsService } from '../conversations/conversations.service';
import { condicionModeloVisible, joinUsuarioDeModelo } from './modelo-visible';

describe('modelo-visible', () => {
  it('exige catalogo activo, usuario activo y ninguna sancion vigente', () => {
    const sql = condicionModeloVisible('e', 'u');
    expect(sql).toContain('e.catalogo_activo = true');
    expect(sql).toContain('u.activo = true');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('disciplinary_sanctions');
    expect(sql).toContain('s.subject_id = e.id');
    expect(sql).toContain(`s.status = 'active'`);
    expect(sql).toContain('s.starts_at <= now()');
    expect(sql).toContain(`(s.type = 'permanent_ban' OR s.ends_at > now())`);
  });

  it('respeta los alias de la consulta que lo incluye', () => {
    expect(joinUsuarioDeModelo('emp', 'cuenta')).toBe(
      'INNER JOIN usuarios cuenta ON cuenta.id = emp.usuario_id',
    );
    const sql = condicionModeloVisible('emp', 'cuenta');
    expect(sql).toContain('emp.catalogo_activo = true');
    expect(sql).toContain('cuenta.activo = true');
    expect(sql).toContain('s.subject_id = emp.id');
  });

  it('es el mismo criterio que usa el chat web al abrir una conversacion', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const servicio = new ConversationsService(
      dataSource as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'cliente-1' }) } as never,
      {} as never,
      {} as never,
    );

    await expect(
      servicio.openWithEmployee('usuario-1', 'empleada-1'),
    ).rejects.toThrow('Modelo no disponible');

    const [sql] = dataSource.query.mock.calls[0] as [string];
    expect(sql).toContain(joinUsuarioDeModelo('e', 'u'));
    expect(sql).toContain(condicionModeloVisible('e', 'u'));
  });
});
