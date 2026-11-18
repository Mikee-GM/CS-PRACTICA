import { Logger } from '@nestjs/common';
import type { ConversationNotifier } from '../conversations/conversation-notifier';
import {
  PALABRAS_VETADAS_WEB,
  palabrasVetadasEn,
} from '../ai/vocabulario-vetado';
import {
  avisarAlChatWeb,
  textoAvisoCancelacionPorDemora,
  textoConVocabularioWeb,
  textoWebSeguro,
} from './aviso-al-cliente-web';

/**
 * Los avisos del chat web no dicen nada de lo que el prompt web le veta a la
 * IA: ni "la empleada", ni "la agencia", ni "el jefe", ni emojis.
 *
 * Lo que se prueba es lo que sale hacia la web a partir del texto base.
 */

const EMOJI = /\p{Extended_Pictographic}/u;

function expectTextoWebLimpio(texto: string): void {
  expect(palabrasVetadasEn(texto)).toEqual([]);
  expect(texto).not.toMatch(EMOJI);
  expect(texto).not.toMatch(/[*`]/);
}

/*
 * El texto base de cada sitio que avisa al chat web, tal como lo escribe
 * el servicio (o la IA, en su respaldo), con su respaldo cuando lo lleva. Si se
 * anade un aviso nuevo, va aqui.
 */
function textosDeLosSitios(nombre: string | null) {
  const quien = nombre || 'la empleada';
  const Quien = nombre || 'La empleada';
  const ia = (respaldo: string) => ({ texto: respaldo, respaldo });
  return {
    reprogramacion: {
      texto: `Amor, te confirmo el cambio de horario: nuestra cita con ${nombre ?? 'tu cita'} queda para el 20/11/2026, 3:00 p.m.. Cualquier cosa me dices por aquí.`,
    },
    cancelacionManualPendiente: ia(
      'Qué pena contigo, esta vez no voy a poder ir',
    ),
    cancelacionManualConfirmada: ia(
      'Qué pena contigo, al final no voy a poder ir, discúlpame de verdad',
    ),
    cancelacionPorDemora: { texto: textoAvisoCancelacionPorDemora(nombre) },
    aceptacion: ia('Oyeee, sí puedo ir contigo, nos vemos en un ratico'),
    rechazo: ia('Qué pena contigo, esta vez no voy a poder ir'),
    extensionUna: { texto: 'La extensión de 1 hora quedó registrada.' },
    extensionVarias: { texto: 'La extensión de 2 horas quedó registrada.' },
    finProximo: {
      texto:
        'El servicio termina en aproximadamente 15 minutos. Si deseas extenderlo, indícaselo a la empleada.',
    },
    nuevaHoraDeLlegada: ia(
      `Soy el asistente de la agencia. La cita anterior se extendió; la nueva hora aproximada de llegada de ${quien} es 21:30.`,
    ),
    sucesorDisponible: ia(
      `Soy el asistente de la agencia. ${Quien} ya está disponible y se encuentra en la misma ubicación.`,
    ),
    sucesorEnCamino: ia(
      `Soy el asistente de la agencia. ${Quien} terminó su servicio anterior y ahora va en camino.`,
    ),
    trayectoEnCamino: ia('Ya voy en camino, nos vemos pronto'),
    trayectoLlegada: ia('Ya llegué al punto que cuadramos, aquí te espero'),
    recordatorio: ia(
      'Hola amor, te confirmo que todo está listo para nuestra cita de las 21:00, ya me estoy preparando.',
    ),
    llegadaConChoferPropio: ia(
      'Ya llegué al punto que cuadramos, aquí te espero',
    ),
    regresoCompletado: {
      texto: 'El servicio quedó completado: la empleada llegó a su destino.',
    },
  } satisfies Record<string, { texto: string; respaldo?: string }>;
}

/*
 * Lo que la IA podria devolver en lugar de su respaldo: redacta como
 * "asistente de la agencia" o en personaje, no con el prompt web, y nada
 * impide que suelte cualquiera de las palabras.
 */
const REDACCIONES_DE_IA_HOSTILES = [
  'Soy el asistente de la agencia. Tu cita quedó confirmada \u{1F525}',
  '*Hola amor* \u{1F618} el jefe ya aprobó tu servicio en el sistema.',
  'La empleada va en camino. La agencia te agradece tu preferencia.',
  'Te escribe la asistente de la agencia: la modelo ya llegó \u{2764}\u{FE0F}',
  ...PALABRAS_VETADAS_WEB.map(
    (palabra) => `Ya voy para allá. Lo confirma ${palabra} ahora mismo.`,
  ),
  ...PALABRAS_VETADAS_WEB.map(
    (palabra) => `${palabra.toUpperCase()} dice que todo listo.`,
  ),
];

describe('textoConVocabularioWeb', () => {
  it('nombra a quien atiende por su nombre artistico', () => {
    expect(
      textoConVocabularioWeb(
        'Si deseas extenderlo, indícaselo a la empleada.',
        'Valentina',
      ),
    ).toBe('Si deseas extenderlo, indícaselo a Valentina.');
  });

  it('sin nombre dice "quien te atiende", con mayuscula al empezar', () => {
    expect(
      textoConVocabularioWeb(
        'La empleada ya está disponible. Avísale a la modelo.',
        null,
      ),
    ).toBe('Quien te atiende ya está disponible. Avísale a quien te atiende.');
  });

  it('no repite el nombre cuando el texto ya lo traia', () => {
    expect(
      textoConVocabularioWeb('Llegó la empleada Valentina.', 'Valentina'),
    ).toBe('Llegó Valentina.');
  });

  it('quita la presentacion como asistente de la agencia', () => {
    expect(
      textoConVocabularioWeb(
        'Soy el asistente de la agencia. Valentina ya va en camino.',
        'Valentina',
      ),
    ).toBe('Valentina ya va en camino.');
  });
});

describe('textoWebSeguro', () => {
  it('usa el respaldo adaptado si la IA dijo algo vetado', () => {
    expect(
      textoWebSeguro('El jefe aprobó tu cita.', 'Valentina', {
        respaldo: 'Oyeee, sí puedo ir contigo',
      }),
    ).toBe('Oyeee, sí puedo ir contigo');
  });

  it('sin respaldo limpio quita solo las frases que dicen algo vetado', () => {
    expect(
      textoWebSeguro(
        'Tu cita quedó confirmada. El jefe ya lo sabe. Nos vemos pronto.',
        'Valentina',
      ),
    ).toBe('Tu cita quedó confirmada. Nos vemos pronto.');
  });

  it('un texto limpio sale igual', () => {
    expect(textoWebSeguro('Qué pena contigo', 'Valentina')).toBe(
      'Qué pena contigo',
    );
  });
});

describe('todos los avisos al chat web', () => {
  for (const nombre of ['Valentina', null]) {
    const sitios = textosDeLosSitios(nombre);

    for (const [sitio, { texto, respaldo }] of Object.entries(sitios) as Array<
      [string, { texto: string; respaldo?: string }]
    >) {
      it(`${sitio} (${nombre ?? 'sin nombre'}) sale sin vocabulario vetado ni emojis y sin perderse`, () => {
        const web = textoWebSeguro(texto, nombre, { respaldo });
        expect(web).not.toBe('');
        expectTextoWebLimpio(web);
      });

      if (respaldo) {
        it(`${sitio} (${nombre ?? 'sin nombre'}) sigue limpio aunque la IA redacte lo que quiera`, () => {
          for (const redaccion of REDACCIONES_DE_IA_HOSTILES) {
            const web = textoWebSeguro(redaccion, nombre, { respaldo });
            expect(web).not.toBe('');
            expectTextoWebLimpio(web);
          }
        });
      }
    }
  }

  it('sin respaldo, ninguna redaccion hostil deja pasar nada vetado', () => {
    for (const redaccion of REDACCIONES_DE_IA_HOSTILES) {
      expectTextoWebLimpio(textoWebSeguro(redaccion, 'Valentina'));
    }
  });

  it('lo que llega al notificador ya va limpio y, si no queda nada, no se manda', async () => {
    const notifier = { notifyClient: jest.fn().mockResolvedValue(true) };
    const logger = { error: jest.fn(), warn: jest.fn() } as unknown as Logger;
    const servicio = {
      id: 'svc-1',
      clienteId: 'cli-1',
      empleadaId: 'emp-1',
      cliente: { usuarioId: 'usr-1' },
      empleada: { nombreArtistico: 'Valentina' },
    };

    for (const redaccion of REDACCIONES_DE_IA_HOSTILES) {
      await avisarAlChatWeb(
        notifier as unknown as ConversationNotifier,
        logger,
        servicio,
        redaccion,
      );
    }
    for (const [aviso] of notifier.notifyClient.mock.calls as Array<
      [{ texto: string }]
    >) {
      expectTextoWebLimpio(aviso.texto);
    }

    notifier.notifyClient.mockClear();
    const entregado = await avisarAlChatWeb(
      notifier as unknown as ConversationNotifier,
      logger,
      servicio,
      'El jefe lo vera en el sistema.',
    );
    expect(entregado).toBe(false);
    expect(notifier.notifyClient).not.toHaveBeenCalled();
  });
});
