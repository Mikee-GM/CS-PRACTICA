import * as Joi from 'joi';

/**
 * Valida `WEB_URL`: una URL o varias separadas por comas.
 *
 * `main.ts` la parte por comas para el CORS (varios origenes) y
 * `client-accounts` toma el primero para los enlaces, asi que la validacion
 * tiene que aceptar la lista. Con `Joi.string().uri()` a secas, dos origenes
 * eran una URL invalida y el backend no arrancaba.
 */
export const webUrlSchema = Joi.string()
  .custom((value: string, helpers) => {
    const origenes = value.split(',').map((origen) => origen.trim());
    const invalido = origenes.find(
      (origen) => origen === '' || Joi.string().uri().validate(origen).error,
    );
    if (invalido !== undefined) return helpers.error('any.invalid');
    return value;
  }, 'lista de URIs separada por comas')
  .messages({
    'any.invalid':
      '{{#label}} debe ser una URI o una lista de URIs separadas por comas',
  });
