/**
 * Palabras que nunca se le dicen al cliente en el chat web.
 *
 * Es una sola lista para los dos sitios que hablan con el en ese chat: el
 * prompt web se la prohibe a la IA (`prompts.ts`) y los avisos del servicio,
 * que no los redacta el prompt web sino textos fijos,
 * se filtran con ella (`services/aviso-al-cliente-web.ts`). Si estuvieran
 * copiadas, una palabra anadida a una lista se le seguiria escapando a la otra.
 *
 * La estructura interna es secreta por politica de producto: quien coordina,
 * como se reparte el trabajo y que hay detras del chat no es asunto del
 * cliente. El orden importa solo porque el prompt las enumera tal cual.
 */
export const PALABRAS_VETADAS_WEB: readonly string[] = [
  'sistema',
  'el sistema',
  'plataforma',
  'base de datos',
  'registro',
  'app',
  'aplicación',
  'catálogo web',
  'página web',
  'agencia',
  'administrador',
  'jefe',
  'operador',
  'telefonista',
  'soporte',
  'empleada',
  'empleadas',
  'modelo',
  'modelos',
];

/** Minusculas y sin acentos, para que "Aplicacion" cuente como "aplicación". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/*
 * Palabra completa: "jefe" no debe saltar con "jefecita" ni "app" con
 * "apparel". Las letras y numeros a cada lado son los que la alargarian.
 */
const PATRONES_VETADOS = PALABRAS_VETADAS_WEB.map(
  (palabra) =>
    [
      palabra,
      new RegExp(
        `(?<![\\p{L}\\p{N}])${normalizar(palabra)}(?![\\p{L}\\p{N}])`,
        'u',
      ),
    ] as const,
);

/** Las palabras vetadas que aparecen en el texto; vacio si no hay ninguna. */
export function palabrasVetadasEn(texto: string): string[] {
  const normalizado = normalizar(texto);
  return PATRONES_VETADOS.filter(([, patron]) => patron.test(normalizado)).map(
    ([palabra]) => palabra,
  );
}
