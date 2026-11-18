import { IN_CHARACTER_DEFLECTIONS_WEB } from '../ai/ai-guardrails';
import {
  corregirRetrocesoDeDuracion,
  evaluarMarca,
  vestirRespuestaIa,
} from './respuesta-ia';

describe('vestirRespuestaIa', () => {
  it('quita marcas, enlaces y el ofrecimiento de mostrador', () => {
    const vestida = vestirRespuestaIa(
      'Son $2500 la hora. ¿En qué te puedo ayudar? https://x.com [DATA: {}]',
      { canal: 'web' },
    );
    expect(vestida.texto).toBe('Son $2500 la hora.');
    expect(vestida.quitoMostrador).toBe(true);
    expect(vestida.desvio).toBeNull();
  });

  it('en la web deja pasar que se declare IA y quita los emojis', () => {
    const vestida = vestirRespuestaIa('Sí, soy una IA 😊 y te cuento', {
      canal: 'web',
    });
    expect(vestida).toMatchObject({
      texto: 'Sí, soy una IA y te cuento',
      desvio: null,
    });
  });

  it('en la web una respuesta de solo emojis se desvia sin repetir el anterior', () => {
    const anterior = IN_CHARACTER_DEFLECTIONS_WEB[0];
    for (let i = 0; i < 20; i += 1) {
      const vestida = vestirRespuestaIa('😘🔥', {
        canal: 'web',
        ultimoDesvio: anterior,
      });
      expect(IN_CHARACTER_DEFLECTIONS_WEB).toContain(vestida.texto);
      expect(vestida.texto).not.toBe(anterior);
      expect(vestida.sustituida).toBe(false);
    }
  });

  it('en la web el registro de asistente sigue descartandose', () => {
    const vestida = vestirRespuestaIa('Como asistente no puedo ayudarte', {
      canal: 'web',
    });
    expect(IN_CHARACTER_DEFLECTIONS_WEB).toContain(vestida.texto);
    expect(vestida.sustituida).toBe(true);
  });
});

describe('corregirRetrocesoDeDuracion', () => {
  it('no toca nada mientras no haya duracion', () => {
    expect(
      corregirRetrocesoDeDuracion('¿Cuántas horas quieres?', {
        duracionFijada: false,
        ubicacionConfirmada: false,
      }),
    ).toBeNull();
  });

  it('cambia la pregunta de horas por la del paso siguiente', () => {
    expect(
      corregirRetrocesoDeDuracion('¿Cuántas horas quieres?', {
        duracionFijada: true,
        ubicacionConfirmada: true,
      }),
    ).toContain('¿Cómo prefieres pagar');
    expect(
      corregirRetrocesoDeDuracion('¿Cuántas horas quieres?', {
        duracionFijada: true,
        ubicacionConfirmada: false,
      }),
    ).toContain('pin');
  });
});

describe('evaluarMarca', () => {
  it('exige que la pida el cliente y que quede cupo', () => {
    expect(evaluarMarca(false, true)).toBe('no_pedida');
    expect(evaluarMarca(true, false)).toBe('sin_cupo');
    expect(evaluarMarca(true, true)).toBe('permitida');
  });
});
