import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateScreeningQuestionDto } from './candidate-screening.dto';

/**
 * Las opciones de una pregunta se guardan en una columna jsonb y llegan a la
 * pantalla de la candidata: cada elemento tiene que validarse, no solo que el
 * campo sea un arreglo.
 */
describe('CreateScreeningQuestionDto', () => {
  const validar = (options: unknown) =>
    validate(
      plainToInstance(CreateScreeningQuestionDto, {
        text: 'Cuanto tiempo llevas en esto',
        options,
      }),
    );

  it('acepta opciones bien formadas', async () => {
    expect(
      await validar([
        { text: 'Menos de un año' },
        { text: 'Mas', isCorrect: true },
      ]),
    ).toHaveLength(0);
  });

  it('rechaza una opcion sin texto o con tipos equivocados', async () => {
    expect(await validar([{ isCorrect: 'si' }])).not.toHaveLength(0);
    expect(await validar([{ text: 42 }])).not.toHaveLength(0);
  });

  it('rechaza una opcion con un texto desmesurado', async () => {
    expect(await validar([{ text: 'x'.repeat(501) }])).not.toHaveLength(0);
  });

  it('rechaza mas opciones de las razonables', async () => {
    const muchas = Array.from({ length: 11 }, (_, i) => ({ text: `op ${i}` }));
    expect(await validar(muchas)).not.toHaveLength(0);
  });
});
