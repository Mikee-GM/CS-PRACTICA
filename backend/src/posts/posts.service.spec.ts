import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PostStatus } from './entities/post.entity';
import { MAX_MEDIAS, MAX_VIDEOS } from './post-estados';
import { PostsService } from './posts.service';

const MODELO = '11111111-1111-4111-8111-111111111111';
const OTRA_MODELO = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
// Caja ftyp con marca `isom`: lo minimo que `sniffVideoContentType` reconoce.
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.alloc(12),
]);

type FilaMedia = {
  id: string;
  kind: 'imagen' | 'video';
  url: string;
  poster_url: string | null;
  position: number;
};

type Base = {
  post: {
    id: string;
    employeeId: string;
    status: PostStatus;
    caption: string;
  } | null;
  media: FilaMedia[];
};

/**
 * Simula las consultas del servicio sobre un solo post. No es SQL: reproduce
 * lo que cada sentencia condicionada hace con la fila para poder comprobar el
 * comportamiento (quien gana una carrera, que queda tras un error) y no la
 * forma de la consulta. La transaccion restaura el estado si el callback
 * falla, como haria el ROLLBACK.
 */
function crearEntorno(inicial: Partial<Base> = {}) {
  const db: Base = {
    post: {
      id: POST,
      employeeId: MODELO,
      status: 'borrador',
      caption: '',
    },
    media: [],
    ...inicial,
  };
  const registro: Array<{ sql: string; enTransaccion: boolean }> = [];
  let enTransaccion = false;
  let fallarInsert: Error | null = null;
  let contador = 0;

  const filasDe = (sql: string, params: unknown[] = []): unknown[] => {
    registro.push({ sql, enTransaccion });
    const post = db.post;
    const esDeLaModelo = () =>
      post !== null && params[0] === post.id && params[1] === post.employeeId;

    if (/^SELECT status FROM posts/.test(sql)) {
      return esDeLaModelo() ? [{ status: post!.status }] : [];
    }
    if (/AS medias/.test(sql)) {
      return [
        {
          medias: db.media.length,
          videos: db.media.filter((m) => m.kind === 'video').length,
        },
      ];
    }
    if (/^INSERT INTO post_media/.test(sql)) {
      if (fallarInsert) throw fallarInsert;
      db.media.push({
        id: `media-${++contador}`,
        kind: params[1] as 'imagen' | 'video',
        url: params[2] as string,
        poster_url: params[3] as string | null,
        position: params[9] as number,
      });
      return [];
    }
    if (/WITH editado/.test(sql)) {
      if (!post || post.status !== params[1]) return [];
      post.status = params[2] as PostStatus;
      if (params[3] !== null) post.caption = params[3] as string;
      return [{ id: post.id }];
    }
    if (/WITH borrada/.test(sql)) {
      const indice = db.media.findIndex((m) => m.id === params[0]);
      if (indice < 0) return [];
      const [borrada] = db.media.splice(indice, 1);
      return [borrada];
    }
    if (/SET position = position - 1/.test(sql)) {
      for (const m of db.media) {
        if (m.position > (params[1] as number)) m.position -= 1;
      }
      return [];
    }
    if (/^SELECT id FROM post_media/.test(sql)) {
      return [...db.media]
        .sort((a, b) => a.position - b.position)
        .map((m) => ({ id: m.id }));
    }
    if (/^SET CONSTRAINTS/.test(sql)) return [];
    if (/^UPDATE post_media m/.test(sql)) {
      // Cada media toma su posicion; el UNIQUE diferido no se comprueba aqui.
      (params[1] as string[]).forEach((id, indice) => {
        const media = db.media.find((m) => m.id === id);
        if (media) media.position = indice;
      });
      return [];
    }
    if (/WITH enviado/.test(sql)) {
      const origenes = params[2] as string[];
      if (!esDeLaModelo() || !origenes.includes(post!.status)) return [];
      if (db.media.length === 0) return [];
      post!.status = 'pendiente';
      return [{ id: post!.id }];
    }
    if (/^SELECT url, poster_url FROM post_media/.test(sql)) {
      return db.media.map(({ url, poster_url }) => ({ url, poster_url }));
    }
    if (/WITH borrado/.test(sql)) {
      if (!post || post.status !== params[1]) return [];
      db.post = null;
      db.media = [];
      return [{ id: POST }];
    }
    if (/WITH archivado/.test(sql)) {
      if (!post || post.status !== params[1]) return [];
      post.status = 'archivado';
      return [{ id: post.id }];
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
          db.media = copia.media;
          throw error;
        } finally {
          enTransaccion = false;
        }
      },
    ),
  };

  const aEntidad = () =>
    db.post && {
      ...db.post,
      rejectionReason: null,
      submittedAt: null,
      publishedAt: null,
      createdAt: new Date('2026-11-01T12:00:00Z'),
      likeCount: 3,
      media: db.media.map((m) => ({
        id: m.id,
        kind: m.kind,
        url: m.url,
        posterUrl: m.poster_url,
        width: null,
        height: null,
        durationMs: null,
        position: m.position,
      })),
    };
  const posts = {
    create: jest.fn((datos: object) => datos),
    save: jest.fn((datos: object) => {
      db.post = {
        id: POST,
        employeeId: MODELO,
        status: 'borrador',
        caption: '',
        ...datos,
      };
      return Promise.resolve({ ...datos, id: POST });
    }),
    findOne: jest.fn(
      ({ where }: { where: { id: string; employeeId?: string } }) => {
        const entidad = aEntidad();
        if (!entidad || entidad.id !== where.id) return Promise.resolve(null);
        if (where.employeeId && where.employeeId !== entidad.employeeId) {
          return Promise.resolve(null);
        }
        return Promise.resolve(entidad);
      },
    ),
    find: jest.fn(() => Promise.resolve([aEntidad()].filter(Boolean))),
  };

  let subidas = 0;
  const upload = {
    uploadPostMedia: jest.fn(
      ({ kind, buffer }: { kind: 'imagen' | 'video'; buffer: Buffer }) =>
        Promise.resolve({
          url: `https://r2/posts/${++subidas}.${kind === 'video' ? 'mp4' : 'jpg'}`,
          kind,
          mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
          bytes: buffer.length,
        }),
    ),
    uploadPostPoster: jest.fn(() =>
      Promise.resolve({
        url: `https://r2/posts/${++subidas}.jpg`,
        kind: 'imagen',
        mimeType: 'image/jpeg',
        bytes: 6,
      }),
    ),
    deleteFile: jest.fn(() => Promise.resolve({ success: true })),
  };

  const service = new PostsService(
    dataSource as never,
    posts as never,
    upload as never,
  );
  return {
    service,
    db,
    upload,
    posts,
    registro,
    dataSource,
    fallarInsertCon: (error: Error) => {
      fallarInsert = error;
    },
    actual: () => db,
  };
}

function medias(
  cuantas: number,
  kind: 'imagen' | 'video' = 'imagen',
): FilaMedia[] {
  return Array.from({ length: cuantas }, (_, i) => ({
    id: `previa-${kind}-${i}`,
    kind,
    url: `https://r2/previa-${kind}-${i}`,
    poster_url: kind === 'video' ? `https://r2/poster-${i}` : null,
    position: i,
  }));
}

function conPost(status: PostStatus, media: FilaMedia[] = []): Partial<Base> {
  return {
    post: { id: POST, employeeId: MODELO, status, caption: 'antes' },
    media,
  };
}

describe('PostsService', () => {
  describe('crearBorrador', () => {
    it('crea un borrador con el autor y el texto recortado', async () => {
      const { service, posts } = crearEntorno({ post: null });
      const post = await service.crearBorrador({
        employeeId: MODELO,
        authorUserId: 'usuario-1',
        authorRole: 'empleada',
        caption: '  hola  ',
      });
      expect(posts.create).toHaveBeenCalledWith({
        employeeId: MODELO,
        authorUserId: 'usuario-1',
        authorRole: 'empleada',
        caption: 'hola',
        status: 'borrador',
      });
      expect(post).toMatchObject({ id: POST, status: 'borrador', media: [] });
    });

    it('rechaza un texto mas largo que el tope', async () => {
      const { service } = crearEntorno({ post: null });
      await expect(
        service.crearBorrador({
          employeeId: MODELO,
          authorUserId: 'usuario-1',
          authorRole: 'empleada',
          caption: 'x'.repeat(2001),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('editarCaption', () => {
    it('devuelve a revision un aprobado y renueva su envio', async () => {
      const entorno = crearEntorno(conPost('aprobado', medias(1)));
      const post = await entorno.service.editarCaption(POST, MODELO, 'nuevo');
      expect(post).toMatchObject({ status: 'pendiente', caption: 'nuevo' });
      const editado = entorno.dataSource.query.mock.calls.find(([sql]) =>
        sql.includes('WITH editado'),
      );
      // `vuelveARevision`: el post entra a la cola por el final.
      expect(editado?.[1]?.[4]).toBe(true);
    });

    it('devuelve a borrador un rechazado', async () => {
      const { service } = crearEntorno(conPost('rechazado', medias(1)));
      await expect(
        service.editarCaption(POST, MODELO, 'corregido'),
      ).resolves.toMatchObject({ status: 'borrador', caption: 'corregido' });
    });

    it('deja pendiente un pendiente sin tocar su envio', async () => {
      const entorno = crearEntorno(conPost('pendiente', medias(1)));
      await expect(
        entorno.service.editarCaption(POST, MODELO, 'x'),
      ).resolves.toMatchObject({ status: 'pendiente' });
      const editado = entorno.dataSource.query.mock.calls.find(([sql]) =>
        sql.includes('WITH editado'),
      );
      expect(editado?.[1]?.[4]).toBe(false);
    });

    it('no edita un archivado', async () => {
      const { service } = crearEntorno(conPost('archivado', medias(1)));
      await expect(
        service.editarCaption(POST, MODELO, 'x'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('responde 404 a un post ajeno sin escribir nada', async () => {
      const entorno = crearEntorno(conPost('borrador'));
      await expect(
        entorno.service.editarCaption(POST, OTRA_MODELO, 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(entorno.actual().post?.caption).toBe('antes');
    });
  });

  describe('enviar', () => {
    it('no envia un post sin media', async () => {
      const { service, db } = crearEntorno(conPost('borrador'));
      await expect(service.enviar(POST, MODELO)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.post?.status).toBe('borrador');
    });

    it('envia un borrador con media', async () => {
      const { service } = crearEntorno(conPost('borrador', medias(1)));
      await expect(service.enviar(POST, MODELO)).resolves.toMatchObject({
        status: 'pendiente',
      });
    });

    it('reenvia un rechazado', async () => {
      const { service } = crearEntorno(conPost('rechazado', medias(1)));
      await expect(service.enviar(POST, MODELO)).resolves.toMatchObject({
        status: 'pendiente',
      });
    });

    it('con dos envios a la vez, uno gana y el otro recibe 409', async () => {
      const { service } = crearEntorno(conPost('borrador', medias(1)));
      const resultados = await Promise.allSettled([
        service.enviar(POST, MODELO),
        service.enviar(POST, MODELO),
      ]);
      const ganados = resultados.filter((r) => r.status === 'fulfilled');
      const perdidos = resultados.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ganados).toHaveLength(1);
      expect(perdidos).toHaveLength(1);
      expect(perdidos[0].reason).toBeInstanceOf(ConflictException);
    });

    it('no envia un aprobado ni un archivado', async () => {
      for (const estado of ['aprobado', 'archivado'] as const) {
        const { service } = crearEntorno(conPost(estado, medias(1)));
        await expect(service.enviar(POST, MODELO)).rejects.toBeInstanceOf(
          ConflictException,
        );
      }
    });

    it('responde 404 a un post ajeno', async () => {
      const { service, db } = crearEntorno(conPost('borrador', medias(1)));
      await expect(service.enviar(POST, OTRA_MODELO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.post?.status).toBe('borrador');
    });
  });

  describe('agregarMedia', () => {
    it('agrega fotos al final, con posiciones seguidas', async () => {
      const { service } = crearEntorno(conPost('borrador'));
      await service.agregarMedia(POST, MODELO, { buffer: JPEG });
      const post = await service.agregarMedia(POST, MODELO, { buffer: JPEG });
      expect(post.media.map((m) => [m.kind, m.position])).toEqual([
        ['imagen', 0],
        ['imagen', 1],
      ]);
    });

    it('sube video y portada; el tipo lo deciden los bytes', async () => {
      const { service, upload } = crearEntorno(conPost('borrador'));
      const post = await service.agregarMedia(POST, MODELO, {
        buffer: MP4,
        posterBuffer: JPEG,
        durationMs: 12_000,
      });
      expect(upload.uploadPostMedia).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'video', employeeId: MODELO }),
      );
      expect(upload.uploadPostPoster).toHaveBeenCalled();
      expect(post.media[0]).toMatchObject({
        kind: 'video',
        posterUrl: expect.stringContaining('https://r2/') as unknown,
      });
    });

    it(`rechaza la media numero ${MAX_MEDIAS + 1} sin subir nada`, async () => {
      const { service, upload } = crearEntorno(
        conPost('borrador', medias(MAX_MEDIAS)),
      );
      await expect(
        service.agregarMedia(POST, MODELO, { buffer: JPEG }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upload.uploadPostMedia).not.toHaveBeenCalled();
    });

    it(`rechaza el video numero ${MAX_VIDEOS + 1}`, async () => {
      const { service, upload } = crearEntorno(
        conPost('borrador', medias(MAX_VIDEOS, 'video')),
      );
      await expect(
        service.agregarMedia(POST, MODELO, {
          buffer: MP4,
          posterBuffer: JPEG,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upload.uploadPostMedia).not.toHaveBeenCalled();
    });

    it('exige portada a un video', async () => {
      const { service, upload } = crearEntorno(conPost('borrador'));
      await expect(
        service.agregarMedia(POST, MODELO, { buffer: MP4 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upload.uploadPostMedia).not.toHaveBeenCalled();
    });

    it('rechaza un video que declara mas de 30 segundos', async () => {
      const { service, upload } = crearEntorno(conPost('borrador'));
      await expect(
        service.agregarMedia(POST, MODELO, {
          buffer: MP4,
          posterBuffer: JPEG,
          durationMs: 30_001,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upload.uploadPostMedia).not.toHaveBeenCalled();
    });

    it('rechaza portada en una foto', async () => {
      const { service } = crearEntorno(conPost('borrador'));
      await expect(
        service.agregarMedia(POST, MODELO, {
          buffer: JPEG,
          posterBuffer: JPEG,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no agrega a un post archivado', async () => {
      const { service, upload } = crearEntorno(conPost('archivado'));
      await expect(
        service.agregarMedia(POST, MODELO, { buffer: JPEG }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(upload.uploadPostMedia).not.toHaveBeenCalled();
    });

    it('responde 404 a un post ajeno sin subir nada', async () => {
      const { service, upload } = crearEntorno(conPost('borrador'));
      await expect(
        service.agregarMedia(POST, OTRA_MODELO, { buffer: JPEG }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(upload.uploadPostMedia).not.toHaveBeenCalled();
    });

    it('borra de R2 video y portada si el INSERT falla', async () => {
      const entorno = crearEntorno(conPost('borrador'));
      entorno.fallarInsertCon(new Error('fallo de base'));
      await expect(
        entorno.service.agregarMedia(POST, MODELO, {
          buffer: MP4,
          posterBuffer: JPEG,
        }),
      ).rejects.toThrow('fallo de base');
      expect(entorno.upload.deleteFile.mock.calls).toEqual([
        ['https://r2/posts/1.mp4'],
        ['https://r2/posts/2.jpg'],
      ]);
      expect(entorno.actual().media).toHaveLength(0);
    });

    it('borra el video si falla la subida de la portada', async () => {
      const { service, upload } = crearEntorno(conPost('borrador'));
      upload.uploadPostPoster.mockRejectedValueOnce(
        new BadRequestException('portada invalida'),
      );
      await expect(
        service.agregarMedia(POST, MODELO, {
          buffer: MP4,
          posterBuffer: JPEG,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upload.deleteFile).toHaveBeenCalledWith('https://r2/posts/1.mp4');
    });

    it('agregar media a un aprobado lo devuelve a revision', async () => {
      const { service } = crearEntorno(conPost('aprobado', medias(1)));
      await expect(
        service.agregarMedia(POST, MODELO, { buffer: JPEG }),
      ).resolves.toMatchObject({ status: 'pendiente' });
    });
  });

  describe('quitarMedia', () => {
    it('quita una media, recompacta posiciones y borra su archivo', async () => {
      const { service, upload } = crearEntorno(conPost('borrador', medias(3)));
      const post = await service.quitarMedia(POST, MODELO, 'previa-imagen-1');
      expect(post.media.map((m) => [m.id, m.position])).toEqual([
        ['previa-imagen-0', 0],
        ['previa-imagen-2', 1],
      ]);
      expect(upload.deleteFile).toHaveBeenCalledWith(
        'https://r2/previa-imagen-1',
      );
    });

    it('un fallo de R2 no tumba la operacion', async () => {
      const { service, upload } = crearEntorno(
        conPost('borrador', medias(2, 'video')),
      );
      upload.deleteFile.mockRejectedValue(new Error('R2 caido'));
      await expect(
        service.quitarMedia(POST, MODELO, 'previa-video-0'),
      ).resolves.toMatchObject({ media: [{ id: 'previa-video-1' }] });
      expect(upload.deleteFile).toHaveBeenCalledTimes(2);
    });

    it('no deja sin media un post en revision', async () => {
      const { service, db, upload } = crearEntorno(
        conPost('pendiente', medias(1)),
      );
      await expect(
        service.quitarMedia(POST, MODELO, 'previa-imagen-0'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.media).toHaveLength(1);
      expect(upload.deleteFile).not.toHaveBeenCalled();
    });

    it('responde 404 a una media que no es del post', async () => {
      const { service } = crearEntorno(conPost('borrador', medias(1)));
      await expect(
        service.quitarMedia(POST, MODELO, 'otra'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reordenarMedia', () => {
    it('reordena en una sola transaccion con el UNIQUE diferido', async () => {
      const entorno = crearEntorno(conPost('borrador', medias(3)));
      const post = await entorno.service.reordenarMedia(POST, MODELO, [
        'previa-imagen-2',
        'previa-imagen-0',
        'previa-imagen-1',
      ]);
      expect(post.media.map((m) => m.id)).toEqual([
        'previa-imagen-2',
        'previa-imagen-0',
        'previa-imagen-1',
      ]);
      expect(entorno.dataSource.transaction).toHaveBeenCalledTimes(1);
      const sentencias = entorno.registro.filter(
        ({ sql }) =>
          sql.startsWith('SET CONSTRAINTS') ||
          sql.startsWith('UPDATE post_media m'),
      );
      expect(sentencias).toEqual([
        {
          sql: 'SET CONSTRAINTS uq_post_media_post_position DEFERRED',
          enTransaccion: true,
        },
        {
          sql: expect.stringContaining('UPDATE post_media m') as unknown,
          enTransaccion: true,
        },
      ]);
    });

    it('rechaza una lista incompleta, ajena o con repetidos', async () => {
      const { service } = crearEntorno(conPost('borrador', medias(2)));
      for (const ids of [
        ['previa-imagen-0'],
        ['previa-imagen-0', 'otra'],
        ['previa-imagen-0', 'previa-imagen-0'],
      ]) {
        await expect(
          service.reordenarMedia(POST, MODELO, ids),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('el mismo orden no saca del feed a un aprobado', async () => {
      const { service, db } = crearEntorno(conPost('aprobado', medias(2)));
      await service.reordenarMedia(POST, MODELO, [
        'previa-imagen-0',
        'previa-imagen-1',
      ]);
      expect(db.post?.status).toBe('aprobado');
    });

    it('cambiar el orden de un aprobado lo devuelve a revision', async () => {
      const { service } = crearEntorno(conPost('aprobado', medias(2)));
      await expect(
        service.reordenarMedia(POST, MODELO, [
          'previa-imagen-1',
          'previa-imagen-0',
        ]),
      ).resolves.toMatchObject({ status: 'pendiente' });
    });
  });

  describe('borrar', () => {
    it('borra de verdad un borrador y su media en R2', async () => {
      const entorno = crearEntorno(conPost('borrador', medias(1, 'video')));
      await expect(entorno.service.borrar(POST, MODELO)).resolves.toEqual({
        id: POST,
        resultado: 'borrado',
      });
      expect(entorno.actual().post).toBeNull();
      expect(entorno.upload.deleteFile.mock.calls).toEqual([
        ['https://r2/previa-video-0'],
        ['https://r2/poster-0'],
      ]);
    });

    it('borra de verdad un rechazado', async () => {
      const entorno = crearEntorno(conPost('rechazado', medias(1)));
      await expect(entorno.service.borrar(POST, MODELO)).resolves.toEqual({
        id: POST,
        resultado: 'borrado',
      });
    });

    it.each(['pendiente', 'aprobado'] as const)(
      'archiva un %s sin tocar R2',
      async (estado) => {
        const entorno = crearEntorno(conPost(estado, medias(1)));
        await expect(entorno.service.borrar(POST, MODELO)).resolves.toEqual({
          id: POST,
          resultado: 'archivado',
        });
        expect(entorno.actual().post?.status).toBe('archivado');
        expect(entorno.upload.deleteFile).not.toHaveBeenCalled();
      },
    );

    it('borrar un archivado no falla ni cambia nada', async () => {
      const { service } = crearEntorno(conPost('archivado', medias(1)));
      await expect(service.borrar(POST, MODELO)).resolves.toEqual({
        id: POST,
        resultado: 'archivado',
      });
    });

    it('responde 404 a un post ajeno', async () => {
      const { service, db } = crearEntorno(conPost('borrador'));
      await expect(service.borrar(POST, OTRA_MODELO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.post).not.toBeNull();
    });
  });

  describe('listarDeLaModelo', () => {
    it('pide uno de mas y devuelve cursor cuando hay otra pagina', async () => {
      const { service, dataSource, posts } = crearEntorno(
        conPost('borrador', medias(1)),
      );
      dataSource.query.mockResolvedValueOnce([{ id: POST }, { id: 'otro' }]);
      const pagina = await service.listarDeLaModelo(MODELO, { limit: 1 });
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain(`p.status <> 'archivado'`);
      expect(params).toEqual([MODELO, null, 2]);
      expect(posts.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ employeeId: MODELO }) as unknown,
        }),
      );
      expect(pagina.nextCursor).toBe(POST);
      expect(pagina.items[0]).toMatchObject({
        id: POST,
        likeCount: 3,
        rejectionReason: null,
        media: [{ id: 'previa-imagen-0', kind: 'imagen', position: 0 }],
      });
    });

    it('sin mas paginas no hay cursor', async () => {
      const { service, dataSource } = crearEntorno();
      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.listarDeLaModelo(MODELO)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    });
  });

  it('modeloDelPost responde 404 si el post no existe', async () => {
    const { service } = crearEntorno({ post: null });
    await expect(service.modeloDelPost(POST)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
