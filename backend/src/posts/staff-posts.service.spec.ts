import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PostAuthorRole, PostStatus } from './entities/post.entity';
import {
  codificarCursor,
  decodificarCursor,
  StaffPostsService,
} from './staff-posts.service';

const MODELO = '11111111-1111-4111-8111-111111111111';
const OTRA_MODELO = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const PUBLICADO_ANTES = new Date('2026-10-01T12:00:00Z');

const ADMIN = { id: 'admin-1', rol: 'admin' as const };
const JEFE = { id: 'jefe-1', rol: 'jefe' as const };
const OTRO_JEFE = { id: 'jefe-2', rol: 'jefe' as const };

type FilaPost = {
  id: string;
  employeeId: string;
  status: PostStatus;
  authorRole: PostAuthorRole;
  medias: number;
  publishedAt: Date | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
};

/**
 * Simula las sentencias del servicio sobre un solo post, como el spec de
 * `PostsService`: no es SQL, reproduce lo que cada UPDATE condicionado hace
 * con la fila para comprobar quien gana una carrera y que queda tras un
 * ROLLBACK. Las modelos tienen como jefe principal a `jefe-1` y como
 * secundario a nadie; `jefe-2` solo las alcanza si `jefe-1` no puede atender.
 */
function crearEntorno(inicial: Partial<FilaPost> = {}) {
  const db: { post: FilaPost | null } = {
    post: {
      id: POST,
      employeeId: MODELO,
      status: 'pendiente',
      authorRole: 'empleada',
      medias: 1,
      publishedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      ...inicial,
    },
  };
  const registro: Array<{ sql: string; enTransaccion: boolean }> = [];
  let enTransaccion = false;
  let fallarAprobacion = false;

  const filasDe = (sql: string, params: unknown[] = []): unknown[] => {
    registro.push({ sql, enTransaccion });
    const post = db.post;
    const esDelPost = () =>
      post !== null && params[0] === post.id && params[1] === post.employeeId;

    if (/^WITH aprobado/.test(sql)) {
      if (fallarAprobacion) throw new Error('fallo simulado');
      if (!esDelPost() || post!.status !== 'pendiente') return [];
      post!.status = 'aprobado';
      post!.reviewedBy = params[2] as string;
      post!.publishedAt ??= new Date('2026-11-17T12:00:00Z');
      post!.rejectionReason = null;
      return [{ id: post!.id }];
    }
    if (/^WITH rechazado/.test(sql)) {
      if (!esDelPost() || post!.status !== 'pendiente') return [];
      post!.status = 'rechazado';
      post!.reviewedBy = params[2] as string;
      post!.rejectionReason = params[3] as string;
      return [{ id: post!.id }];
    }
    if (/^WITH archivado/.test(sql)) {
      if (!esDelPost() || post!.status !== params[2]) return [];
      post!.status = 'archivado';
      return [{ id: post!.id }];
    }
    if (/^WITH enviado/.test(sql)) {
      if (!esDelPost() || post!.status !== params[2] || post!.medias < 1) {
        return [];
      }
      post!.status = 'pendiente';
      post!.rejectionReason = null;
      return [{ id: post!.id }];
    }
    if (/^SELECT status, author_role FROM posts/.test(sql)) {
      return esDelPost()
        ? [{ status: post!.status, author_role: post!.authorRole }]
        : [];
    }
    if (/AS medias/.test(sql)) return [{ medias: post?.medias ?? 0 }];
    if (/^SELECT p\.id, p\.caption/.test(sql)) {
      if (!post || params[0] !== post.id) return [];
      return [
        {
          id: post.id,
          caption: '',
          status: post.status,
          rejection_reason: post.rejectionReason,
          submitted_at: null,
          reviewed_at: null,
          published_at: post.publishedAt,
          created_at: new Date('2026-11-01T12:00:00Z'),
          like_count: 4,
          author_role: post.authorRole,
          cursor_at: '2026-11-01T12:00:00.000000Z',
          employee_id: post.employeeId,
          nombre_artistico: 'Luna',
          foto_perfil_url: null,
          media: null,
        },
      ];
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  };

  const query = jest.fn((sql: string, params?: unknown[]) =>
    Promise.resolve().then(() => filasDe(sql.trim(), params)),
  );
  const manager = { query };
  const dataSource = {
    query,
    transaction: jest.fn(
      async (callback: (m: typeof manager) => Promise<unknown>) => {
        const copia = structuredClone(db);
        enTransaccion = true;
        try {
          return await callback(manager);
        } catch (error) {
          db.post = copia.post;
          throw error;
        } finally {
          enTransaccion = false;
        }
      },
    ),
  };

  // `jefe-1` es el principal de MODELO; OTRA_MODELO es de `jefe-3`, que
  // atiende, asi que queda fuera del alcance de `jefe-1`.
  const jefeQueAtiende = (id: string) => ({
    id,
    activo: true,
    disponible: true,
    enJornada: true,
  });
  const modelos = [
    {
      id: MODELO,
      jefeId: 'jefe-1',
      jefeSecundarioId: null,
      jefe: jefeQueAtiende('jefe-1'),
      jefeSecundario: null,
    },
    {
      id: OTRA_MODELO,
      jefeId: 'jefe-3',
      jefeSecundarioId: null,
      jefe: jefeQueAtiende('jefe-3'),
      jefeSecundario: null,
    },
  ];
  const empleadas = {
    find: jest.fn(() => Promise.resolve(modelos)),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(modelos.find((m) => m.id === where.id) ?? null),
    ),
  };

  const postsService = {
    modeloDelPost: jest.fn((id: string) =>
      db.post && db.post.id === id
        ? Promise.resolve(db.post.employeeId)
        : Promise.reject(new NotFoundException('Post no encontrado')),
    ),
    crearBorrador: jest.fn(() => Promise.resolve({ id: POST })),
    editarCaption: jest.fn(() => Promise.resolve({})),
    agregarMedia: jest.fn(() => Promise.resolve({})),
    quitarMedia: jest.fn(() => Promise.resolve({})),
    reordenarMedia: jest.fn(() => Promise.resolve({})),
    borrar: jest.fn(() =>
      Promise.resolve({ id: POST, resultado: 'archivado' as const }),
    ),
  };
  const realtime = { emitToEmployee: jest.fn() };

  const service = new StaffPostsService(
    dataSource as never,
    empleadas as never,
    postsService as never,
    realtime as never,
  );

  return {
    service,
    db,
    query,
    registro,
    dataSource,
    empleadas,
    postsService,
    realtime,
    fallarAprobacion: () => {
      fallarAprobacion = true;
    },
  };
}

describe('StaffPostsService', () => {
  describe('alcance', () => {
    it('un jefe sin modelos a su alcance recibe una cola vacia sin consultar posts', async () => {
      const { service, query, empleadas } = crearEntorno();
      empleadas.find.mockResolvedValueOnce([]);

      await expect(service.listar(JEFE, {})).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(query).not.toHaveBeenCalled();
    });

    it('la cola de un jefe se limita a sus modelos y la del admin no', async () => {
      const { service, query } = crearEntorno();
      query.mockResolvedValue([]);

      await service.listar(JEFE, {});
      const [sqlJefe, paramsJefe] = query.mock.calls[0] as [string, unknown[]];
      expect(sqlJefe).toContain('p.employee_id = ANY($2::uuid[])');
      expect(paramsJefe[1]).toEqual([MODELO]);

      await service.listar(ADMIN, {});
      const [sqlAdmin, paramsAdmin] = query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(sqlAdmin).not.toContain('ANY(');
      expect(paramsAdmin).toEqual(['pendiente', 21]);
    });

    it('fuera de alcance, el detalle y aprobar responden 404 sin tocar el post', async () => {
      const { service, db, empleadas } = crearEntorno({
        employeeId: OTRA_MODELO,
      });

      await expect(service.obtener(JEFE, POST)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.aprobar(JEFE, POST)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.rechazar(JEFE, POST, 'motivo'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.post!.status).toBe('pendiente');
      // Siempre se mira la modelo del post.
      expect(empleadas.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OTRA_MODELO } }),
      );
    });

    it('fuera de alcance tambien para un post archivado o rechazado', async () => {
      for (const status of ['archivado', 'rechazado'] as const) {
        const { service } = crearEntorno({ employeeId: OTRA_MODELO, status });
        await expect(service.obtener(JEFE, POST)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        await expect(service.archivar(JEFE, POST)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }
    });

    it('el admin aprueba posts de cualquier modelo', async () => {
      const { service, db } = crearEntorno({ employeeId: OTRA_MODELO });

      const post = await service.aprobar(ADMIN, POST);

      expect(post.status).toBe('aprobado');
      expect(db.post!.reviewedBy).toBe('admin-1');
    });

    it('un jefe de relevo alcanza la modelo cuyo jefe no puede atender', async () => {
      const { service, empleadas } = crearEntorno();
      empleadas.findOne.mockResolvedValueOnce({
        id: MODELO,
        jefeId: 'jefe-1',
        jefeSecundarioId: null,
        jefe: { id: 'jefe-1', activo: false },
        jefeSecundario: null,
      } as never);

      await expect(service.aprobar(OTRO_JEFE, POST)).resolves.toMatchObject({
        status: 'aprobado',
      });
    });

    it('un post inexistente responde 404', async () => {
      const { service } = crearEntorno();
      await expect(
        service.obtener(JEFE, '99999999-9999-4999-8999-999999999999'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cola', () => {
    it('pendiente va por submitted_at ascendente y los demas por created_at descendente', async () => {
      const { service, query } = crearEntorno();
      query.mockResolvedValue([]);

      await service.listar(ADMIN, {});
      await service.listar(ADMIN, { estado: 'aprobado' });

      const [cola, otros] = query.mock.calls.map(([sql]) => sql);
      expect(cola).toMatch(/ORDER BY p\.submitted_at ASC, p\.id ASC/);
      expect(otros).toMatch(/ORDER BY p\.created_at DESC, p\.id DESC/);
    });

    it('pide uno de mas, devuelve el limite y un cursor que avanza en el sentido del orden', async () => {
      const { service, query } = crearEntorno();
      const fila = (id: string, fecha: string) => ({
        id,
        caption: '',
        status: 'pendiente',
        rejection_reason: null,
        submitted_at: new Date(fecha),
        reviewed_at: null,
        published_at: null,
        created_at: new Date(fecha),
        like_count: '0',
        author_role: 'empleada',
        cursor_at: fecha,
        employee_id: MODELO,
        nombre_artistico: 'Luna',
        foto_perfil_url: null,
        media: [
          {
            id: 'm1',
            kind: 'video',
            url: 'https://r2/v.mp4',
            posterUrl: 'https://r2/p.jpg',
            width: 720,
            height: 1280,
            durationMs: 12000,
            position: 0,
          },
        ],
      });
      const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      query.mockResolvedValueOnce([
        fila(A, '2026-11-17T10:00:00.000001Z'),
        fila(B, '2026-11-17T11:00:00.000000Z'),
      ]);

      const pagina = await service.listar(JEFE, { limit: 1 });

      expect(pagina.items).toHaveLength(1);
      expect(pagina.items[0]).toMatchObject({
        id: A,
        likeCount: 0,
        authorRole: 'empleada',
        employee: { id: MODELO, nombreArtistico: 'Luna', fotoPerfilUrl: null },
        media: [{ kind: 'video', posterUrl: 'https://r2/p.jpg' }],
      });
      expect(pagina.nextCursor).toBe(
        codificarCursor({ fecha: '2026-11-17T10:00:00.000001Z', id: A }),
      );
      expect((query.mock.calls[0][1] as unknown[]).at(-1)).toBe(2);

      query.mockResolvedValueOnce([]);
      await service.listar(JEFE, { cursor: pagina.nextCursor! });
      const [sql, params] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('(p.submitted_at, p.id) > ($3::timestamptz');
      expect(params).toEqual(
        expect.arrayContaining(['2026-11-17T10:00:00.000001Z', A]),
      );
    });

    it('filtra por modelo ademas del alcance', async () => {
      const { service, query } = crearEntorno();
      query.mockResolvedValue([]);

      await service.listar(JEFE, { employeeId: OTRA_MODELO });

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ANY($2::uuid[])');
      expect(sql).toContain('p.employee_id = $3::uuid');
      expect(params.slice(1, 3)).toEqual([[MODELO], OTRA_MODELO]);
    });

    it('un cursor mal formado responde 400', async () => {
      const { service } = crearEntorno();
      await expect(
        service.listar(ADMIN, { cursor: 'basura' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(() =>
        decodificarCursor(
          Buffer.from('2026-11-17T10:00:00Z|x').toString('base64url'),
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('aprobar y rechazar', () => {
    it('de dos aprobaciones simultaneas gana una y la otra recibe 409', async () => {
      const { service, realtime } = crearEntorno();

      const resultados = await Promise.allSettled([
        service.aprobar(JEFE, POST),
        service.aprobar(ADMIN, POST),
      ]);

      const ganadas = resultados.filter((r) => r.status === 'fulfilled');
      const perdidas = resultados.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ganadas).toHaveLength(1);
      expect(perdidas).toHaveLength(1);
      expect(perdidas[0].reason).toBeInstanceOf(ConflictException);
      // Solo la que gano avisa a la modelo.
      expect(realtime.emitToEmployee).toHaveBeenCalledTimes(1);
    });

    it('aprobar conserva published_at de un post que ya estuvo publicado', async () => {
      const { service, db, query } = crearEntorno({
        publishedAt: PUBLICADO_ANTES,
      });

      const post = await service.aprobar(JEFE, POST);

      expect(post.publishedAt).toEqual(PUBLICADO_ANTES);
      expect(db.post!.publishedAt).toEqual(PUBLICADO_ANTES);
      const sql = query.mock.calls
        .map(([s]) => s)
        .find((s) => /WITH aprobado/.test(s));
      expect(sql).toContain('published_at = COALESCE(published_at, now())');
      expect(sql).toContain("status = 'pendiente'");
    });

    it('aprobar fija revisor, limpia el motivo y avisa a la modelo', async () => {
      const { service, db, realtime } = crearEntorno();

      await service.aprobar(JEFE, POST);

      expect(db.post).toMatchObject({
        status: 'aprobado',
        reviewedBy: 'jefe-1',
        rejectionReason: null,
      });
      expect(realtime.emitToEmployee).toHaveBeenCalledWith(MODELO, {
        type: 'post_approved',
        data: { postId: POST, eventId: expect.any(String) },
      });
    });

    it('aprobar algo que no esta pendiente responde 409 y no avisa', async () => {
      const { service, realtime } = crearEntorno({ status: 'borrador' });

      await expect(service.aprobar(JEFE, POST)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(realtime.emitToEmployee).not.toHaveBeenCalled();
    });

    it('rechazar exige motivo', async () => {
      const { service, db, query } = crearEntorno();

      await expect(service.rechazar(JEFE, POST, '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.post!.status).toBe('pendiente');
      expect(query).not.toHaveBeenCalled();
    });

    it('rechazar guarda el motivo recortado y avisa a la modelo', async () => {
      const { service, db, realtime } = crearEntorno();

      const post = await service.rechazar(JEFE, POST, '  Foto borrosa  ');

      expect(post.status).toBe('rechazado');
      expect(db.post!.rejectionReason).toBe('Foto borrosa');
      expect(realtime.emitToEmployee).toHaveBeenCalledWith(MODELO, {
        type: 'post_rejected',
        data: { postId: POST, eventId: expect.any(String) },
      });
    });

    it('un fallo del aviso no deshace la aprobacion ni devuelve error', async () => {
      const { service, db, realtime } = crearEntorno();
      realtime.emitToEmployee.mockImplementation(() => {
        throw new Error('bus caido');
      });

      await expect(service.aprobar(JEFE, POST)).resolves.toMatchObject({
        status: 'aprobado',
      });
      expect(db.post!.status).toBe('aprobado');
    });
  });

  describe('archivar', () => {
    it.each(['aprobado', 'pendiente'] as const)(
      'archiva un post %s',
      async (status) => {
        const { service, db } = crearEntorno({ status });
        await expect(service.archivar(JEFE, POST)).resolves.toMatchObject({
          status: 'archivado',
        });
        expect(db.post!.status).toBe('archivado');
      },
    );

    it.each(['borrador', 'rechazado', 'archivado'] as const)(
      'un post %s no se archiva: 409',
      async (status) => {
        const { service, db } = crearEntorno({ status });
        await expect(service.archivar(JEFE, POST)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(db.post!.status).toBe(status);
      },
    );
  });

  describe('publicar como el equipo', () => {
    it('encadena borrador -> pendiente -> aprobado en una sola transaccion', async () => {
      const { service, db, registro, dataSource } = crearEntorno({
        status: 'borrador',
        authorRole: 'jefe',
      });

      const post = await service.publicar(JEFE, POST);

      expect(post.status).toBe('aprobado');
      expect(db.post!.reviewedBy).toBe('jefe-1');
      expect(db.post!.publishedAt).not.toBeNull();
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      const pasos = registro.filter(({ sql }) =>
        /^WITH (enviado|aprobado)/.test(sql),
      );
      expect(pasos.map(({ sql }) => sql.split(' ')[1])).toEqual([
        'enviado',
        'aprobado',
      ]);
      expect(pasos.every(({ enTransaccion }) => enTransaccion)).toBe(true);
      // La fila se bloquea antes de decidir.
      expect(
        registro.find(({ sql }) => /^SELECT status, author_role/.test(sql))
          ?.sql,
      ).toContain('FOR UPDATE');
    });

    it('un rechazado de un admin tambien se publica y conserva su published_at', async () => {
      const { service, db } = crearEntorno({
        status: 'rechazado',
        authorRole: 'admin',
        rejectionReason: 'antes',
        publishedAt: PUBLICADO_ANTES,
      });

      await service.publicar(ADMIN, POST);

      expect(db.post).toMatchObject({
        status: 'aprobado',
        rejectionReason: null,
        publishedAt: PUBLICADO_ANTES,
      });
    });

    it('si falla el segundo paso, el ROLLBACK deja el post en borrador', async () => {
      const entorno = crearEntorno({ status: 'borrador', authorRole: 'jefe' });
      entorno.fallarAprobacion();

      await expect(entorno.service.publicar(JEFE, POST)).rejects.toThrow(
        'fallo simulado',
      );
      expect(entorno.db.post!.status).toBe('borrador');
    });

    it('exige al menos una media', async () => {
      const { service, db } = crearEntorno({
        status: 'borrador',
        authorRole: 'jefe',
        medias: 0,
      });

      await expect(service.publicar(JEFE, POST)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.post!.status).toBe('borrador');
    });

    it('un post de la modelo no se publica por esta ruta', async () => {
      const { service, db, registro } = crearEntorno({
        status: 'borrador',
        authorRole: 'empleada',
      });

      await expect(service.publicar(JEFE, POST)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.post!.status).toBe('borrador');
      expect(registro.some(({ sql }) => /^WITH/.test(sql))).toBe(false);
    });

    it('un pendiente o aprobado no se publica: 409', async () => {
      for (const status of ['pendiente', 'aprobado', 'archivado'] as const) {
        const { service, db } = crearEntorno({ status, authorRole: 'jefe' });
        await expect(service.publicar(JEFE, POST)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(db.post!.status).toBe(status);
      }
    });

    it('fuera de alcance responde 404', async () => {
      const { service } = crearEntorno({
        employeeId: OTRA_MODELO,
        status: 'borrador',
        authorRole: 'jefe',
      });
      await expect(service.publicar(JEFE, POST)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('crear usa el rol del actor como autor y exige la modelo al alcance', async () => {
      const { service, postsService } = crearEntorno();

      await service.crear(JEFE, { employeeId: MODELO, caption: 'Hola' });
      await service.crear(ADMIN, { employeeId: OTRA_MODELO, caption: '' });

      expect(postsService.crearBorrador.mock.calls).toEqual([
        [
          {
            employeeId: MODELO,
            authorUserId: 'jefe-1',
            authorRole: 'jefe',
            caption: 'Hola',
          },
        ],
        [
          {
            employeeId: OTRA_MODELO,
            authorUserId: 'admin-1',
            authorRole: 'admin',
            caption: '',
          },
        ],
      ]);
      await expect(
        service.crear(JEFE, { employeeId: OTRA_MODELO, caption: '' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.crear(ADMIN, {
          employeeId: '99999999-9999-4999-8999-999999999999',
          caption: '',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(postsService.crearBorrador).toHaveBeenCalledTimes(2);
    });

    it('editar, media y borrar delegan con la modelo del post tras comprobar el alcance', async () => {
      const { service, postsService } = crearEntorno({ authorRole: 'jefe' });
      const media = { buffer: Buffer.from('x') };

      await service.editarCaption(JEFE, POST, 'nuevo');
      await service.agregarMedia(JEFE, POST, media);
      await service.quitarMedia(JEFE, POST, 'm1');
      await service.reordenarMedia(JEFE, POST, ['m1']);
      await service.borrar(JEFE, POST);

      expect(postsService.editarCaption).toHaveBeenCalledWith(
        POST,
        MODELO,
        'nuevo',
      );
      expect(postsService.agregarMedia).toHaveBeenCalledWith(
        POST,
        MODELO,
        media,
      );
      expect(postsService.quitarMedia).toHaveBeenCalledWith(POST, MODELO, 'm1');
      expect(postsService.reordenarMedia).toHaveBeenCalledWith(POST, MODELO, [
        'm1',
      ]);
      expect(postsService.borrar).toHaveBeenCalledWith(POST, MODELO);
    });

    it('fuera de alcance no delega nada', async () => {
      const { service, postsService } = crearEntorno({
        employeeId: OTRA_MODELO,
      });

      await expect(
        service.editarCaption(JEFE, POST, 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.borrar(JEFE, POST)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(postsService.editarCaption).not.toHaveBeenCalled();
      expect(postsService.borrar).not.toHaveBeenCalled();
    });
  });
});
