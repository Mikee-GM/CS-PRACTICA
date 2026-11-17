import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  agruparPorServicio,
  MAX_SERVICIOS_POR_VALORAR,
  ServiceFeedbackService,
  VENTANA_DE_VALORACION_MS,
} from './service-feedback.service';

describe('ServiceFeedbackService', () => {
  function armar(
    respuestas: Array<unknown[]> = [],
    opciones: { rating?: Record<string, unknown>; created?: boolean } = {},
  ) {
    const query = jest.fn();
    for (const respuesta of respuestas) query.mockResolvedValueOnce(respuesta);
    query.mockResolvedValue([]);
    const discipline = {
      createClientRatingIdempotent: jest.fn().mockResolvedValue({
        rating: {
          employeeId: 'emp-1',
          stars: 4,
          comment: null,
          ...opciones.rating,
        },
        created: opciones.created ?? true,
      }),
      addClientRatingReason: jest.fn().mockResolvedValue({}),
    };
    const employeeReports = {
      createFromClientAccount: jest.fn().mockResolvedValue({
        id: 'reporte-1',
        category: 'cobro',
        createdAt: new Date('2026-11-17T10:00:00Z'),
        bossId: 'jefe-1',
        employeeId: 'emp-1',
        description: 'no debe salir',
      }),
      createFromDriverAccount: jest.fn().mockResolvedValue({
        id: 'reporte-2',
        category: 'seguridad',
        createdAt: new Date('2026-11-17T11:00:00Z'),
        bossId: 'jefe-1',
      }),
    };
    const conversations = {
      openWithEmployee: jest
        .fn()
        .mockResolvedValue({ conversation: { id: 'conv-2' }, creada: true }),
    };
    const realtime = { emitToClient: jest.fn() };
    const service = new ServiceFeedbackService(
      { query } as never,
      discipline as never,
      employeeReports as never,
      conversations as never,
      realtime as never,
    );
    return {
      service,
      query,
      discipline,
      employeeReports,
      conversations,
      realtime,
    };
  }

  const CLIENTE = [{ id: 'cliente-1' }];

  describe('pendientes', () => {
    it('busca con la ficha de la sesion, el plazo y el filtro de la modelo', async () => {
      const { service, query } = armar([CLIENTE, []]);

      await service.pendientes('usuario-1', 'emp-1');

      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FROM clientes WHERE usuario_id = $1'),
        ['usuario-1'],
      );
      const [sql, params] = query.mock.calls[1] as [string, unknown[]];
      expect(params).toEqual([
        'cliente-1',
        VENTANA_DE_VALORACION_MS,
        'emp-1',
        MAX_SERVICIOS_POR_VALORAR,
      ]);
      expect(sql).toContain("s.estado = 'finalizado'");
      expect(sql).toContain("ir.direction = 'client_to_employee'");
    });

    it('sin filtro pasa null, no undefined', async () => {
      const { service, query } = armar([CLIENTE, []]);
      await service.pendientes('usuario-1');
      expect((query.mock.calls[1] as [string, unknown[]])[1][2]).toBeNull();
    });

    it('una cuenta sin ficha de cliente responde 404', async () => {
      const { service } = armar([[]]);
      await expect(service.pendientes('usuario-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('agruparPorServicio', () => {
    it('agrupa a las participantes de un grupal bajo su servicio', () => {
      const fin = new Date('2026-11-17T09:00:00Z');
      const agrupados = agruparPorServicio([
        {
          servicio_id: 's-1',
          finalizado_en: fin,
          service_type: 'grupal',
          empleada_id: 'emp-1',
          nombre_artistico: 'Ana',
          estrellas: 5,
          categorias_reportadas: ['cobro'],
        },
        {
          servicio_id: 's-1',
          finalizado_en: fin,
          service_type: 'grupal',
          empleada_id: 'emp-2',
          nombre_artistico: 'Bela',
          estrellas: null,
          categorias_reportadas: ['cobro'],
        },
        {
          servicio_id: 's-2',
          finalizado_en: fin,
          service_type: 'individual',
          empleada_id: 'emp-3',
          nombre_artistico: 'Carla',
          estrellas: null,
          categorias_reportadas: null,
        },
      ]);

      expect(agrupados).toEqual([
        {
          servicioId: 's-1',
          finalizadoEn: fin,
          grupal: true,
          modelos: [
            { id: 'emp-1', nombreArtistico: 'Ana', estrellas: 5 },
            { id: 'emp-2', nombreArtistico: 'Bela', estrellas: null },
          ],
          categoriasReportadas: ['cobro'],
        },
        {
          servicioId: 's-2',
          finalizadoEn: fin,
          grupal: false,
          modelos: [{ id: 'emp-3', nombreArtistico: 'Carla', estrellas: null }],
          categoriasReportadas: [],
        },
      ]);
    });
  });

  describe('calificar', () => {
    it('entra por la via idempotente del bot y refleja las estrellas en el servicio', async () => {
      const { service, discipline, query } = armar([CLIENTE]);

      const resultado = await service.calificar('usuario-1', 'serv-1', {
        estrellas: 4,
      });

      expect(discipline.createClientRatingIdempotent).toHaveBeenCalledWith(
        'cliente-1',
        {
          direction: 'client_to_employee',
          interactionId: 'serv-1',
          employeeId: undefined,
          stars: 4,
          comment: undefined,
        },
      );
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('calificacion IS NULL'),
        ['serv-1', 'emp-1', 4],
      );
      expect(resultado).toEqual({
        calificacion: {
          servicioId: 'serv-1',
          empleadaId: 'emp-1',
          estrellas: 4,
        },
        creada: true,
      });
    });

    it('el motivo se guarda como comentario si no escribio uno', async () => {
      const { service, discipline } = armar([CLIENTE]);
      await service.calificar('usuario-1', 'serv-1', {
        estrellas: 2,
        motivo: 'puntualidad',
      });
      expect(discipline.createClientRatingIdempotent).toHaveBeenCalledWith(
        'cliente-1',
        expect.objectContaining({ comment: 'Puntualidad' }),
      );
    });

    it('el comentario escrito gana al motivo', async () => {
      const { service, discipline } = armar([CLIENTE]);
      await service.calificar('usuario-1', 'serv-1', {
        estrellas: 2,
        motivo: 'otro',
        comentario: 'Llego una hora tarde',
      });
      expect(discipline.createClientRatingIdempotent).toHaveBeenCalledWith(
        'cliente-1',
        expect.objectContaining({ comment: 'Llego una hora tarde' }),
      );
    });

    it('repetida devuelve la primera, no toca el servicio y admite el motivo despues', async () => {
      const { service, discipline, query } = armar([CLIENTE], {
        created: false,
        rating: { stars: 3 },
      });

      const resultado = await service.calificar('usuario-1', 'serv-1', {
        estrellas: 5,
        motivo: 'trato',
      });

      expect(resultado.creada).toBe(false);
      expect(resultado.calificacion.estrellas).toBe(3);
      expect(query).toHaveBeenCalledTimes(1);
      expect(discipline.addClientRatingReason).toHaveBeenCalledWith(
        'cliente-1',
        'serv-1',
        'trato',
      );
    });

    it('en un grupal no usa el motivo tardio, que no distingue participantes', async () => {
      const { service, discipline } = armar([CLIENTE], { created: false });
      await service.calificar('usuario-1', 'serv-1', {
        estrellas: 3,
        motivo: 'trato',
        empleadaId: 'emp-2',
      });
      expect(discipline.addClientRatingReason).not.toHaveBeenCalled();
    });
  });

  describe('reportes', () => {
    it('el del cliente devuelve solo id, categoria y fecha', async () => {
      const { service, employeeReports } = armar();
      const reporte = await service.reportar('usuario-1', 'serv-1', {
        categoria: 'cobro',
        descripcion: 'Me cobraron de mas',
      });
      expect(employeeReports.createFromClientAccount).toHaveBeenCalledWith(
        'usuario-1',
        'serv-1',
        'cobro',
        'Me cobraron de mas',
      );
      expect(reporte).toEqual({
        id: 'reporte-1',
        categoria: 'cobro',
        creadoEn: new Date('2026-11-17T10:00:00Z'),
      });
    });

    it('el del chofer va por viaje', async () => {
      const { service, employeeReports } = armar();
      const reporte = await service.reportarDesdeElChofer('usuario-2', {
        viajeId: 'viaje-1',
        categoria: 'seguridad',
        descripcion: 'Descripcion valida',
      });
      expect(employeeReports.createFromDriverAccount).toHaveBeenCalledWith(
        'usuario-2',
        'viaje-1',
        'seguridad',
        'Descripcion valida',
      );
      expect(Object.keys(reporte).sort()).toEqual([
        'categoria',
        'creadoEn',
        'id',
      ]);
    });
  });

  describe('volverAContratar', () => {
    it('un servicio ajeno o inexistente responde 404', async () => {
      const { service, conversations } = armar([CLIENTE, []]);
      await expect(
        service.volverAContratar('usuario-1', 'serv-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(conversations.openWithEmployee).not.toHaveBeenCalled();
    });

    it('un servicio sin terminar responde 409', async () => {
      const { service } = armar([
        CLIENTE,
        [{ empleada_id: 'emp-1', estado: 'en_curso' }],
      ]);
      await expect(
        service.volverAContratar('usuario-1', 'serv-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('cierra el chat del servicio terminado, lo anuncia y abre otro con la misma modelo', async () => {
      const { service, query, conversations, realtime } = armar([
        CLIENTE,
        [{ empleada_id: 'emp-1', estado: 'finalizado' }],
        [{ id: 'conv-1' }],
      ]);

      const resultado = await service.volverAContratar('usuario-1', 'serv-1');

      const [sql, params] = query.mock.calls[2] as [string, unknown[]];
      expect(sql).toContain("status = 'con_servicio'");
      expect(sql).toContain('service_id = $3');
      expect(params).toEqual(['cliente-1', 'emp-1', 'serv-1']);
      expect(realtime.emitToClient).toHaveBeenCalledWith('cliente-1', {
        type: 'conversation_status_changed',
        data: { conversationId: 'conv-1', status: 'cerrada' },
      });
      expect(conversations.openWithEmployee).toHaveBeenCalledWith(
        'usuario-1',
        'emp-1',
      );
      expect(resultado).toEqual({
        conversation: { id: 'conv-2' },
        creada: true,
      });
    });

    it('si no habia chat colgado del servicio no anuncia nada', async () => {
      const { service, realtime, conversations } = armar([
        CLIENTE,
        [{ empleada_id: 'emp-1', estado: 'finalizado' }],
        [],
      ]);
      await service.volverAContratar('usuario-1', 'serv-1');
      expect(realtime.emitToClient).not.toHaveBeenCalled();
      expect(conversations.openWithEmployee).toHaveBeenCalled();
    });
  });
});
