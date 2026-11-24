import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ColumnNumericTransformer } from '../../common/transformers/column-numeric.transformer';
import { Clientes } from '../../clients/entities/client.entity';

/**
 * Un beneficio que la agencia le da a un cliente. Hay una fila por cliente y
 * tipo, asi que cada beneficio se otorga una sola vez aunque se reclame varias.
 */
@Index('beneficios_cliente_cliente_tipo_key', ['clienteId', 'tipo'], {
  unique: true,
})
@Entity('beneficios_cliente', { schema: 'public' })
export class BeneficioDeCliente {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'cliente_id' })
  clienteId: string;

  @ManyToOne(() => Clientes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cliente_id' })
  cliente: Clientes;

  @Column('character varying', { name: 'tipo', length: 40 })
  tipo: string;

  /** Porcentaje de la base del servicio que no se cobra. */
  @Column('numeric', {
    name: 'porcentaje',
    precision: 5,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  porcentaje: number;

  @Column('timestamp with time zone', {
    name: 'otorgado_at',
    default: () => 'now()',
  })
  otorgadoAt: Date;

  @Column('timestamp with time zone', { name: 'caduca_at' })
  caducaAt: Date;

  /** El servicio que lo usa. Vacio mientras esta disponible. */
  @Column('uuid', { name: 'servicio_id', nullable: true })
  servicioId: string | null;
}
