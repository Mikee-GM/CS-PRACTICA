import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { condicionModeloVisible } from '../employees/modelo-visible';
import {
  codificarCursor,
  decodificarCursor,
  FeedService,
  SIN_DECLARACION_DE_EDAD,
} from './feed.service';

const USUARIO = 'usuario-1';
const CLIENTE = 'cliente-1';
const MODELO = '33333333-3333-4333-8333-333333333333';
const POST = '11111111-1111-4111-8111-111111111111';

/** Id de post deterministico y ordenable: el n-esimo de la serie. */
function idDePost(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * Fila tal como la devolveria la consulta del feed. `cursor_at` lleva
 * microsegundos, como `to_char(... 'US')`.
 */
function filaPost(n: number, cursorAt: string) {
  return {
    id: idDePost(n),
    caption: `Post ${n}`,
    published_at: new Date(cursorAt),
    cursor_at: cursorAt,
    like_count: n,
    liked_by_me: n % 2 === 0,
    employee_id: MODELO,
    nombre_artistico: 'Valentina',
    slug_catalogo: 'valentina',
    foto_perfil_url: 'https://cdn/valentina.jpg',
    media: [
      {
        id: `media-${n}`,
        kind: 'imagen',
        url: `https://cdn/posts/${n}.jpg`,
        posterUrl: null,
        width: 1080,
        height: 1350,
        durationMs: null,
        position: 0,
      },
    ],
  };
}

type Fila = ReturnType<typeof filaPost>;

/**
 * Simula la consulta del feed sobre un conjunto de filas: aplica el cursor
 * como tupla `(cursor_at, id) <` y el LIMIT con los parametros que recibe,
 * para comprobar que la paginacion encadenada no salta ni repite.
 */
function simularFeed(todas: Fila[]) {
  const ordenadas = [...todas].sort((a, b) =>
    a.cursor_at === b.cursor_at
      ? b.id.localeCompare(a.id)
      : b.cursor_at.localeCompare(a.cursor_at),
  );
  return (sql: string, params: unknown[]) => {
    const limit = params[params.length - 1] as number;
    let filas = ordenadas;
    if (sql.includes('(p.published_at, p.id) <')) {
      const cursorAt = params[params.length - 3] as string;
      const cursorId = params[params.length - 2] as string;
      filas = filas.filter(
        (fila) =>
          fila.cursor_at < cursorAt ||
          (fila.cursor_at === cursorAt && fila.id < cursorId),
      );
    }
    return Promise.resolve(filas.slice(0, limit));
  };
}

describe('FeedService', () => {
  let dataSource: { query: jest.Mock };
  let clientesRepository: { findOne: jest.Mock };
  let servicio: FeedService;

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    clientesRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: CLIENTE,
        mayorDeEdadDeclaradoAt: new Date('2026-11-01T10:00:00Z'),
      }),
    };
    servicio = new FeedService(
      dataSource as never,
      clientesRepository as never,
    );
  });

  describe('ficha del cliente', () => {
    it('lee la ficha por el usuario de la sesion con su declaracion 18+', async () => {
      dataSource.query.mockResolvedValue([]);

      await servicio.listFeed(USUARIO, {});

      expect(clientesRepository.findOne).toHaveBeenCalledWith({
        where: { usuarioId: USUARIO },
        select: { id: true, mayorDeEdadDeclaradoAt: true },
      });
    });

    it('sin ficha de cliente responde 404', async () => {
      clientesRepository.findOne.mockResolvedValue(null);

      await expect(servicio.listFeed(USUARIO, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it.each([
      ['el feed general', (s: FeedService) => s.listFeed(USUARIO, {})],
      [
        'el feed de una modelo',
        (s: FeedService) => s.listModelFeed(USUARIO, 'valentina', {}),
      ],
      ['dar like', (s: FeedService) => s.like(USUARIO, POST)],
      ['quitar like', (s: FeedService) => s.unlike(USUARIO, POST)],
    ])(
      'sin declaracion 18+ niega %s con 403 y no consulta posts',
      async (_caso, llamar) => {
        clientesRepository.findOne.mockResolvedValue({
          id: CLIENTE,
          mayorDeEdadDeclaradoAt: null,
        });

        const promesa = llamar(servicio);
        await expect(promesa).rejects.toThrow(ForbiddenException);
        await expect(promesa).rejects.toThrow(SIN_DECLARACION_DE_EDAD);
        expect(dataSource.query).not.toHaveBeenCalled();
      },
    );
  });

  describe('listFeed', () => {
    it('pide limit + 1, solo aprobados de modelos visibles, ordenado por tupla', async () => {
      dataSource.query.mockResolvedValue([]);

      await servicio.listFeed(USUARIO, { limit: 5 });

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params).toEqual([CLIENTE, 6]);
      expect(sql).toContain(`p.status = 'aprobado'`);
      expect(sql).toContain(condicionModeloVisible('e', 'u'));
      expect(sql).toContain('INNER JOIN usuarios u ON u.id = e.usuario_id');
      expect(sql).toContain('ORDER BY p.published_at DESC, p.id DESC');
      expect(sql).toContain('l.client_id = $1::uuid');
      expect(sql).toContain('ORDER BY m.position');
      expect(sql).not.toContain('(p.published_at, p.id) <');
    });

    it('usa 10 por defecto', async () => {
      dataSource.query.mockResolvedValue([]);

      await servicio.listFeed(USUARIO, {});

      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params[params.length - 1]).toBe(11);
    });

    it('con cursor compara la tupla (published_at, id) con microsegundos', async () => {
      dataSource.query.mockResolvedValue([]);
      const cursor = codificarCursor({
        publishedAt: '2026-11-16T10:00:00.123456Z',
        id: POST,
      });

      await servicio.listFeed(USUARIO, { cursor, limit: 3 });

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain(
        '(p.published_at, p.id) < ($2::timestamptz, $3::uuid)',
      );
      expect(params).toEqual([CLIENTE, '2026-11-16T10:00:00.123456Z', POST, 4]);
    });

    it('sin otra pagina no devuelve cursor', async () => {
      dataSource.query.mockResolvedValue([
        filaPost(2, '2026-11-16T10:00:00.000002Z'),
        filaPost(1, '2026-11-16T10:00:00.000001Z'),
      ]);

      const pagina = await servicio.listFeed(USUARIO, { limit: 2 });

      expect(pagina.items).toHaveLength(2);
      expect(pagina.nextCursor).toBeNull();
    });

    it('mapea la fila al contrato del cliente sin datos internos', async () => {
      dataSource.query.mockResolvedValue([
        filaPost(2, '2026-11-16T10:00:00.000002Z'),
      ]);

      const { items } = await servicio.listFeed(USUARIO, {});

      expect(items[0]).toEqual({
        id: idDePost(2),
        caption: 'Post 2',
        publishedAt: new Date('2026-11-16T10:00:00.000002Z'),
        likeCount: 2,
        likedByMe: true,
        employee: {
          id: MODELO,
          nombreArtistico: 'Valentina',
          slugCatalogo: 'valentina',
          fotoPerfilUrl: 'https://cdn/valentina.jpg',
        },
        media: [
          {
            id: 'media-2',
            kind: 'imagen',
            url: 'https://cdn/posts/2.jpg',
            posterUrl: null,
            width: 1080,
            height: 1350,
            durationMs: null,
            position: 0,
          },
        ],
      });
    });

    it('un post sin media (json_agg NULL) llega con lista vacia', async () => {
      dataSource.query.mockResolvedValue([
        { ...filaPost(1, '2026-11-16T10:00:00.000001Z'), media: null },
      ]);

      const { items } = await servicio.listFeed(USUARIO, {});

      expect(items[0].media).toEqual([]);
    });

    it('recorre todas las paginas sin saltos ni repeticiones', async () => {
      // Varias filas comparten el mismo milisegundo (y dos el mismo
      // microsegundo): un cursor con precision de milisegundos o sin el id
      // como desempate perderia o repetiria alguna.
      const todas = [
        filaPost(1, '2026-11-16T10:00:00.000100Z'),
        filaPost(2, '2026-11-16T10:00:00.000200Z'),
        filaPost(3, '2026-11-16T10:00:00.000200Z'),
        filaPost(4, '2026-11-16T10:00:00.000300Z'),
        filaPost(5, '2026-11-16T10:00:00.000400Z'),
        filaPost(6, '2026-11-16T10:00:00.000500Z'),
        filaPost(7, '2026-11-16T10:00:01.000000Z'),
      ];
      dataSource.query.mockImplementation(simularFeed(todas));

      const vistos: string[] = [];
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const pagina = await servicio.listFeed(USUARIO, { cursor, limit: 2 });
        vistos.push(...pagina.items.map((item) => item.id));
        cursor = pagina.nextCursor ?? undefined;
        paginas += 1;
      } while (cursor && paginas < 10);

      expect(paginas).toBe(4);
      expect(vistos).toEqual([7, 6, 5, 4, 3, 2, 1].map(idDePost));
    });
  });

  describe('listModelFeed', () => {
    it('busca a la modelo por slug con el criterio compartido y filtra sus posts', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: MODELO }])
        .mockResolvedValueOnce([]);

      await servicio.listModelFeed(USUARIO, 'valentina', { limit: 4 });

      const [sqlModelo, paramsModelo] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sqlModelo).toContain('e.slug_catalogo = $1');
      expect(sqlModelo).toContain(condicionModeloVisible('e', 'u'));
      expect(paramsModelo).toEqual(['valentina']);

      const [sqlFeed, paramsFeed] = dataSource.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(sqlFeed).toContain('p.employee_id = $2::uuid');
      expect(paramsFeed).toEqual([CLIENTE, MODELO, 5]);
    });

    it('con cursor numera los parametros despues de la modelo', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: MODELO }])
        .mockResolvedValueOnce([]);
      const cursor = codificarCursor({
        publishedAt: '2026-11-16T10:00:00.000001Z',
        id: POST,
      });

      await servicio.listModelFeed(USUARIO, 'valentina', { cursor });

      const [sql, params] = dataSource.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(sql).toContain(
        '(p.published_at, p.id) < ($3::timestamptz, $4::uuid)',
      );
      expect(params).toEqual([
        CLIENTE,
        MODELO,
        '2026-11-16T10:00:00.000001Z',
        POST,
        11,
      ]);
    });

    it('una modelo no visible o inexistente responde 404', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      await expect(
        servicio.listModelFeed(USUARIO, 'oculta', {}),
      ).rejects.toThrow(NotFoundException);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('un cursor mal formado responde 400 antes de buscar a la modelo', async () => {
      await expect(
        servicio.listModelFeed(USUARIO, 'valentina', { cursor: 'basura' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('cursor', () => {
    it('ida y vuelta conserva fecha con microsegundos e id', () => {
      const cursor = {
        publishedAt: '2026-11-16T10:00:00.123456Z',
        id: POST,
      };
      expect(decodificarCursor(codificarCursor(cursor))).toEqual(cursor);
    });

    it('sin cursor empieza por el principio', () => {
      expect(decodificarCursor(undefined)).toBeNull();
      expect(decodificarCursor('')).toBeNull();
    });

    it.each([
      ['texto arbitrario', 'basura'],
      ['sin separador', Buffer.from(POST).toString('base64url')],
      [
        'fecha sin microsegundos',
        Buffer.from(`2026-11-16T10:00:00.123Z|${POST}`).toString('base64url'),
      ],
      [
        'fecha imposible',
        Buffer.from(`2026-13-45T10:00:00.000000Z|${POST}`).toString(
          'base64url',
        ),
      ],
      [
        'id que no es uuid',
        Buffer.from('2026-11-16T10:00:00.000000Z|1 OR 1=1').toString(
          'base64url',
        ),
      ],
    ])('rechaza %s con 400', (_caso, valor) => {
      expect(() => decodificarCursor(valor)).toThrow(BadRequestException);
    });

    it('el feed general rechaza un cursor mal formado sin consultar', async () => {
      await expect(
        servicio.listFeed(USUARIO, { cursor: 'basura' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('likes', () => {
    it('dar like inserta con ON CONFLICT DO NOTHING y relee el contador', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: POST }])
        .mockResolvedValueOnce([{ like_count: 8 }]);

      const resultado = await servicio.like(USUARIO, POST);

      expect(resultado).toEqual({ liked: true, likeCount: 8 });
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('INSERT INTO post_likes');
      expect(sql).toContain('ON CONFLICT (post_id, client_id) DO NOTHING');
      expect(sql).toContain(`p.status = 'aprobado'`);
      expect(sql).toContain(condicionModeloVisible('e', 'u'));
      expect(params).toEqual([POST, CLIENTE]);
      expect(dataSource.query.mock.calls[1]).toEqual([
        'SELECT like_count FROM posts WHERE id = $1::uuid',
        [POST],
      ]);
    });

    it('dar like dos veces es idempotente: misma respuesta, mismo contador', async () => {
      // La base absorbe el conflicto; el contador releido no cambia.
      dataSource.query
        .mockResolvedValueOnce([{ id: POST }])
        .mockResolvedValueOnce([{ like_count: 3 }])
        .mockResolvedValueOnce([{ id: POST }])
        .mockResolvedValueOnce([{ like_count: 3 }]);

      const primero = await servicio.like(USUARIO, POST);
      const segundo = await servicio.like(USUARIO, POST);

      expect(primero).toEqual({ liked: true, likeCount: 3 });
      expect(segundo).toEqual(primero);
    });

    it('quitar like borra solo el del cliente y relee el contador', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: POST }])
        .mockResolvedValueOnce([{ like_count: 0 }]);

      const resultado = await servicio.unlike(USUARIO, POST);

      expect(resultado).toEqual({ liked: false, likeCount: 0 });
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('DELETE FROM post_likes l');
      expect(sql).toContain('l.client_id = $2::uuid');
      expect(params).toEqual([POST, CLIENTE]);
    });

    it('quitar un like que no existe no falla', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: POST }])
        .mockResolvedValueOnce([{ like_count: 5 }]);

      await expect(servicio.unlike(USUARIO, POST)).resolves.toEqual({
        liked: false,
        likeCount: 5,
      });
    });

    it.each([
      ['dar like', (s: FeedService) => s.like(USUARIO, POST)],
      ['quitar like', (s: FeedService) => s.unlike(USUARIO, POST)],
    ])(
      '%s en un post no visible o inexistente responde 404 sin releer',
      async (_caso, llamar) => {
        dataSource.query.mockResolvedValueOnce([]);

        await expect(llamar(servicio)).rejects.toThrow(NotFoundException);
        expect(dataSource.query).toHaveBeenCalledTimes(1);
      },
    );
  });
});
