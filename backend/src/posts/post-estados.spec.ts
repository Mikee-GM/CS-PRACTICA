import { POST_STATUSES, PostStatus } from './entities/post.entity';
import {
  MAX_CAPTION,
  MAX_MEDIAS,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SEGUNDOS,
  MAX_VIDEOS,
  esVisibleEnFeed,
  puedeTransicionar,
  siguienteAlEditar,
} from './post-estados';

describe('post-estados', () => {
  const conMedia = { medias: 1 };

  describe('puedeTransicionar', () => {
    it('envia un borrador a revision solo con al menos una media', () => {
      expect(puedeTransicionar('borrador', 'pendiente', conMedia)).toBe(true);
      expect(puedeTransicionar('borrador', 'pendiente', { medias: 0 })).toBe(
        false,
      );
      expect(puedeTransicionar('borrador', 'pendiente')).toBe(false);
    });

    it('resuelve la revision de un pendiente', () => {
      expect(puedeTransicionar('pendiente', 'aprobado')).toBe(true);
      expect(puedeTransicionar('pendiente', 'rechazado')).toBe(true);
    });

    it('devuelve un rechazado a borrador', () => {
      expect(puedeTransicionar('rechazado', 'borrador')).toBe(true);
      expect(puedeTransicionar('rechazado', 'pendiente', conMedia)).toBe(false);
    });

    it('archiva un aprobado o lo devuelve a revision al editarlo', () => {
      expect(puedeTransicionar('aprobado', 'archivado')).toBe(true);
      expect(puedeTransicionar('aprobado', 'pendiente', conMedia)).toBe(true);
      expect(puedeTransicionar('aprobado', 'pendiente', { medias: 0 })).toBe(
        false,
      );
    });

    it('trata archivado como terminal', () => {
      for (const hacia of POST_STATUSES) {
        expect([
          hacia,
          puedeTransicionar('archivado', hacia, conMedia),
        ]).toEqual([hacia, false]);
      }
    });

    it('rechaza saltos no previstos', () => {
      const prohibidas: Array<[PostStatus, PostStatus]> = [
        ['borrador', 'aprobado'],
        ['borrador', 'archivado'],
        ['pendiente', 'borrador'],
        ['pendiente', 'archivado'],
        ['rechazado', 'aprobado'],
        ['aprobado', 'rechazado'],
        ['aprobado', 'borrador'],
        ['borrador', 'borrador'],
      ];
      for (const [desde, hacia] of prohibidas) {
        expect([
          desde,
          hacia,
          puedeTransicionar(desde, hacia, conMedia),
        ]).toEqual([desde, hacia, false]);
      }
    });
  });

  describe('siguienteAlEditar', () => {
    it('devuelve a revision un aprobado y a borrador un rechazado', () => {
      expect(siguienteAlEditar('aprobado')).toBe('pendiente');
      expect(siguienteAlEditar('rechazado')).toBe('borrador');
      expect(siguienteAlEditar('borrador')).toBe('borrador');
      expect(siguienteAlEditar('pendiente')).toBe('pendiente');
    });

    it('no permite editar un archivado', () => {
      expect(siguienteAlEditar('archivado')).toBeNull();
    });
  });

  it('solo muestra en el feed lo aprobado', () => {
    expect(POST_STATUSES.filter(esVisibleEnFeed)).toEqual(['aprobado']);
  });

  it('fija los topes de media acordados', () => {
    expect(MAX_MEDIAS).toBe(10);
    expect(MAX_VIDEOS).toBe(3);
    expect(MAX_VIDEO_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_VIDEO_SEGUNDOS).toBe(30);
    expect(MAX_CAPTION).toBe(2000);
  });
});
