import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListConductReportsQueryDto } from './discipline.dto';

const errores = async (query: Record<string, unknown>) =>
  validate(plainToInstance(ListConductReportsQueryDto, query), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('ListConductReportsQueryDto', () => {
  it('acepta la consulta vacia: sin limit el comportamiento no cambia', async () => {
    expect(await errores({})).toHaveLength(0);
  });

  it('convierte limit y offset de texto a numero dentro del tope', async () => {
    const dto = plainToInstance(ListConductReportsQueryDto, {
      limit: '50',
      offset: '10',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(dto.offset).toBe(10);
  });

  it.each([{ limit: '0' }, { limit: '501' }, { offset: '-1' }, { limit: 'x' }])(
    'rechaza %p',
    async (query) => {
      expect((await errores(query)).length).toBeGreaterThan(0);
    },
  );

  it('rechaza valores de filtro fuera del catalogo y parametros desconocidos', async () => {
    expect((await errores({ status: 'otro' })).length).toBeGreaterThan(0);
    expect((await errores({ foo: 'bar' })).length).toBeGreaterThan(0);
  });
});
