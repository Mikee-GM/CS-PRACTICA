import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Clientes } from '../clients/entities/client.entity';
import { Servicios } from '../services/entities/service.entity';
import { BeneficioDeCliente } from './entities/client-benefit.entity';

export const BENEFICIO_INSTALACION_APP = 'instalacion_app';
/** Porcentaje de la base del servicio que se descuenta. */
export const PORCENTAJE_INSTALACION_APP = 10;
/** Dias que el cliente tiene para usarlo desde que se otorga. */
export const DIAS_DE_VIGENCIA = 60;

export type EstadoDelBeneficio = 'sin_reclamar' | 'disponible' | 'usado' | 'caducado';

export type BeneficioDeInstalacion = {
  estado: EstadoDelBeneficio;
  porcentaje: number;
  /** Cuando caduca, si ya se otorgo. */
  caducaAt: string | null;
};

/**
 * Descuento por instalar la app.
 *
 * El navegador solo puede decir "esta sesion corre como app instalada"; el
 * servidor no puede comprobarlo. Por eso el riesgo se acota por otro lado: una
 * sola vez por cliente, solo con sesion de cliente, y un porcentaje de la base
 * sin tocar lo que cobran la modelo y el chofer.
 */
@Injectable()
export class ClientBenefitsService {
  constructor(
    @InjectRepository(BeneficioDeCliente)
    private readonly beneficios: Repository<BeneficioDeCliente>,
    @InjectRepository(Clientes)
    private readonly clientes: Repository<Clientes>,
  ) {}

  async estadoDeInstalacion(usuarioId: string): Promise<BeneficioDeInstalacion> {
    const clienteId = await this.clienteDe(usuarioId);
    return this.estadoDe(
      await this.beneficios.findOne({
        where: { clienteId, tipo: BENEFICIO_INSTALACION_APP },
      }),
    );
  }

  /**
   * Porcentaje que se le descontaria hoy a este cliente en un servicio nuevo, o 0.
   * Lo usa la reserva por chat para decirle cuanto transferir.
   */
  async porcentajeDisponible(clienteId: string, ahora = new Date()): Promise<number> {
    const beneficio = await this.beneficios.findOne({
      where: { clienteId, tipo: BENEFICIO_INSTALACION_APP },
    });
    if (!beneficio) return 0;
    const estado = await this.estadoDe(beneficio, ahora);
    return estado.estado === 'disponible' ? Number(beneficio.porcentaje) : 0;
  }

  /** Lo otorga la primera vez y devuelve el estado; repetirlo no cambia nada. */
  async reclamarPorInstalacion(
    usuarioId: string,
    ahora = new Date(),
  ): Promise<BeneficioDeInstalacion> {
    const clienteId = await this.clienteDe(usuarioId);
    await this.beneficios
      .createQueryBuilder()
      .insert()
      .values({
        clienteId,
        tipo: BENEFICIO_INSTALACION_APP,
        porcentaje: PORCENTAJE_INSTALACION_APP,
        otorgadoAt: ahora,
        caducaAt: new Date(ahora.getTime() + DIAS_DE_VIGENCIA * 86_400_000),
      })
      .orIgnore()
      .execute();
    return this.estadoDeInstalacion(usuarioId);
  }

  /**
   * Aplica el beneficio disponible al servicio recien guardado, dentro de la
   * misma transaccion que lo creo. Disponible es: sin caducar y sin servicio, o
   * con un servicio que se cancelo (el descuento se devuelve). Devuelve el
   * servicio recargado, porque el trigger recalcula el total al actualizarlo.
   */
  async aplicarAlServicio(
    manager: EntityManager,
    servicio: Servicios,
    ahora = new Date(),
  ): Promise<Servicios> {
    if (!servicio.clienteId) return servicio;
    const beneficio = await manager
      .getRepository(BeneficioDeCliente)
      .createQueryBuilder('b')
      .setLock('pessimistic_write')
      .where('b.cliente_id = :clienteId', { clienteId: servicio.clienteId })
      .andWhere('b.tipo = :tipo', { tipo: BENEFICIO_INSTALACION_APP })
      .andWhere('b.caduca_at > :ahora', { ahora })
      .getOne();
    if (!beneficio) return servicio;

    if (beneficio.servicioId) {
      const anterior = await manager.findOne(Servicios, {
        where: { id: beneficio.servicioId },
        select: { id: true, estado: true },
      });
      // Sigue en uso: otro servicio vivo ya lo consumio.
      if (anterior && anterior.estado !== 'cancelado') return servicio;
      if (anterior) {
        await manager.update(Servicios, anterior.id, {
          descuentoClientePorcentaje: 0,
        });
      }
    }

    await manager.update(Servicios, servicio.id, {
      descuentoClientePorcentaje: beneficio.porcentaje,
    });
    await manager.update(BeneficioDeCliente, beneficio.id, {
      servicioId: servicio.id,
    });
    return manager.findOneOrFail(Servicios, { where: { id: servicio.id } });
  }

  private async estadoDe(
    beneficio: BeneficioDeCliente | null,
    ahora = new Date(),
  ): Promise<BeneficioDeInstalacion> {
    if (!beneficio) {
      return {
        estado: 'sin_reclamar',
        porcentaje: PORCENTAJE_INSTALACION_APP,
        caducaAt: null,
      };
    }
    let usado = false;
    if (beneficio.servicioId) {
      const servicio = await this.beneficios.manager.findOne(Servicios, {
        where: { id: beneficio.servicioId },
        select: { id: true, estado: true },
      });
      usado = Boolean(servicio && servicio.estado !== 'cancelado');
    }
    const caducado = beneficio.caducaAt.getTime() <= ahora.getTime();
    return {
      estado: usado ? 'usado' : caducado ? 'caducado' : 'disponible',
      porcentaje: Number(beneficio.porcentaje),
      caducaAt: beneficio.caducaAt.toISOString(),
    };
  }

  private async clienteDe(usuarioId: string): Promise<string> {
    const cliente = await this.clientes.findOne({
      where: { usuarioId },
      select: { id: true },
    });
    if (!cliente) {
      throw new NotFoundException('Esta cuenta no tiene ficha de cliente');
    }
    return cliente.id;
  }
}
