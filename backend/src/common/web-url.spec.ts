import { webUrlSchema } from './web-url';

describe('webUrlSchema', () => {
  it('acepta una sola URL', () => {
    expect(
      webUrlSchema.validate('https://app.example.com').error,
    ).toBeUndefined();
  });

  it('acepta varias URLs separadas por comas, con espacios', () => {
    expect(
      webUrlSchema.validate('https://app.example.com, http://localhost:3000')
        .error,
    ).toBeUndefined();
  });

  it('rechaza una lista con un elemento que no es URI', () => {
    expect(
      webUrlSchema.validate('https://app.example.com,no-es-uri').error,
    ).toBeDefined();
  });

  it('rechaza elementos vacios y el valor vacio', () => {
    expect(webUrlSchema.validate('https://a.com,').error).toBeDefined();
    expect(webUrlSchema.validate('').error).toBeDefined();
  });

  it('exige el valor cuando se marca required', () => {
    expect(webUrlSchema.required().validate(undefined).error).toBeDefined();
  });
});
