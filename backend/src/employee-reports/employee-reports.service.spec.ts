import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EmployeeReportsService } from './employee-reports.service';

describe('EmployeeReportsService', () => {
  const buildService = (repositories: any = {}) => {
    const dataSource = {
      getRepository: jest.fn((entity: any) => repositories[entity.name]),
    } as any;
    return new EmployeeReportsService({} as any, {} as any, dataSource);
  };

  it('maps category to the agreed automatic priority', () => {
    const service = buildService() as any;
    expect(service.priorityFor('seguridad')).toBe('urgente');
    expect(service.priorityFor('cobro')).toBe('alta');
    expect(service.priorityFor('incumplimiento')).toBe('alta');
    expect(service.priorityFor('trato_inadecuado')).toBe('normal');
  });

  it('rejects a client attempting to report another client service', async () => {
    const service = buildService({
      Clientes: { findOne: jest.fn().mockResolvedValue({ id: 'client-1' }) },
      Servicios: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'service-1', clienteId: 'client-2' }),
      },
    });
    await expect(
      service.createFromClientAccount(
        'usuario-1',
        'service-1',
        'otro',
        'Descripción válida',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('desde la cuenta web del cliente', () => {
    it('busca la ficha por la cuenta de la sesion', async () => {
      const clientes = { findOne: jest.fn().mockResolvedValue(null) };
      const service = buildService({ Clientes: clientes });

      await expect(
        service.createFromClientAccount(
          'usuario-1',
          'service-1',
          'otro',
          'Descripción válida',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(clientes.findOne).toHaveBeenCalledWith({
        where: { usuarioId: 'usuario-1' },
      });
    });

    it('rechaza el servicio de otro cliente', async () => {
      const service = buildService({
        Clientes: {
          findOne: jest.fn().mockResolvedValue({ id: 'client-1' }),
        },
        Servicios: {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'service-1', clienteId: 'client-2' }),
        },
      });
      await expect(
        service.createFromClientAccount(
          'usuario-1',
          'service-1',
          'otro',
          'Descripción válida',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('crea el reporte con la misma clave de reportero que el bot', async () => {
      const service = buildService({
        Clientes: {
          findOne: jest.fn().mockResolvedValue({ id: 'client-1' }),
        },
        Servicios: {
          findOne: jest.fn().mockResolvedValue({
            id: 'service-1',
            clienteId: 'client-1',
            estado: 'finalizado',
            horaFinServicio: new Date(Date.now() - 60_000),
          }),
        },
      }) as any;
      const createVerified = jest.fn().mockResolvedValue({ id: 'report-1' });
      service.createVerified = createVerified;

      await service.createFromClientAccount(
        'usuario-1',
        'service-1',
        'cobro',
        'Me cobraron de mas',
      );

      expect(createVerified).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: 'cliente',
          clientId: 'client-1',
          driverId: null,
          reporterKey: 'cliente:client-1',
          category: 'cobro',
        }),
      );
    });
  });

  describe('desde el portal del chofer', () => {
    it('solo acepta un viaje finalizado del propio chofer', async () => {
      const viajes = { findOne: jest.fn().mockResolvedValue(null) };
      const service = buildService({
        Choferes: {
          findOne: jest.fn().mockResolvedValue({ id: 'chofer-1' }),
        },
        Viajes: viajes,
      });

      await expect(
        service.createFromDriverAccount(
          'usuario-2',
          'viaje-ajeno',
          'otro',
          'Descripción válida',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(viajes.findOne).toHaveBeenCalledWith({
        where: {
          id: 'viaje-ajeno',
          choferId: 'chofer-1',
          estado: 'finalizado',
        },
        relations: { servicio: true },
      });
    });

    it('rechaza una cuenta sin ficha de chofer', async () => {
      const service = buildService({
        Choferes: { findOne: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        service.createFromDriverAccount(
          'usuario-3',
          'viaje-1',
          'otro',
          'Descripción válida',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza un viaje fuera de la ventana de 24 horas', async () => {
      const service = buildService({
        Choferes: {
          findOne: jest.fn().mockResolvedValue({ id: 'chofer-1' }),
        },
        Viajes: {
          findOne: jest.fn().mockResolvedValue({
            id: 'viaje-1',
            horaFinViaje: new Date(Date.now() - 25 * 60 * 60 * 1000),
            servicio: { id: 'service-1' },
          }),
        },
      });
      await expect(
        service.createFromDriverAccount(
          'usuario-2',
          'viaje-1',
          'otro',
          'Descripción válida',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reporta el servicio del viaje con la clave del chofer', async () => {
      const servicio = { id: 'service-1', empleadaId: 'emp-1' };
      const service = buildService({
        Choferes: {
          findOne: jest.fn().mockResolvedValue({ id: 'chofer-1' }),
        },
        Viajes: {
          findOne: jest.fn().mockResolvedValue({
            id: 'viaje-1',
            horaFinViaje: new Date(Date.now() - 60_000),
            servicio,
          }),
        },
      }) as any;
      const createVerified = jest.fn().mockResolvedValue({ id: 'report-2' });
      service.createVerified = createVerified;

      await service.createFromDriverAccount(
        'usuario-2',
        'viaje-1',
        'seguridad',
        'Descripción válida',
      );

      expect(createVerified).toHaveBeenCalledWith(
        expect.objectContaining({
          service: servicio,
          origin: 'chofer',
          driverId: 'chofer-1',
          clientId: null,
          reporterKey: 'chofer:chofer-1',
        }),
      );
    });
  });

  it('rejects reports after the 24 hour window', () => {
    const service = buildService() as any;
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1);
    expect(() => service.assertWithinWindow(expired, 'El servicio')).toThrow(
      ConflictException,
    );
  });

  it('does not expose another boss report', async () => {
    const reports = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'report-1', bossId: 'boss-2' }),
    };
    /*
     * Se construye por nombre y no con `new`.
     *
     * Con la lista posicional, cada dependencia nueva del servicio desplazaba todos
     * los dobles y estas pruebas fallaban por un motivo ajeno a lo que probaban.
     * Los campos inicializados de la clase entran como dobles porque
     * `Object.create` no los ejecuta.
     */
    const service = Object.create(
      EmployeeReportsService.prototype,
    ) as EmployeeReportsService;
    Object.assign(service, {
      reports,
      history: {},
      dataSource: {},
    });
    await expect(
      service.findOne('report-1', { id: 'boss-1', rol: 'jefe' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activates tolerance exactly at 3 reports and 5 extensions', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          employeeId: 'employee-1',
          employeeName: 'Empleada',
          reports90Days: 3,
          reportsHistorical: 3,
          extensions30Days: 5,
          extensionsHistorical: 5,
        },
      ]),
    };
    /*
     * Se construye por nombre y no con `new`.
     *
     * Con la lista posicional, cada dependencia nueva del servicio desplazaba todos
     * los dobles y estas pruebas fallaban por un motivo ajeno a lo que probaban.
     * Los campos inicializados de la clase entran como dobles porque
     * `Object.create` no los ejecuta.
     */
    const service = Object.create(
      EmployeeReportsService.prototype,
    ) as EmployeeReportsService;
    Object.assign(service, {
      reports: {},
      history: {},
      dataSource,
    });
    const [metric] = await service.tolerance({ rol: 'admin' } as any);
    expect(metric.reportsOverTolerance).toBe(true);
    expect(metric.extensionsOverTolerance).toBe(true);
  });
});
