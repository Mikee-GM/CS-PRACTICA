import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangeClientPasswordDto } from './dto/change-client-password.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';

async function propiedadesConError<T extends object>(
  clase: new () => T,
  datos: Record<string, unknown>,
) {
  const dto = plainToInstance(clase, datos);
  const fallos = await validate(dto);
  return { dto, propiedades: fallos.map((f) => f.property) };
}

describe('UpdateClientProfileDto', () => {
  it('recorta el nombre', async () => {
    const { dto, propiedades } = await propiedadesConError(
      UpdateClientProfileDto,
      { nombre: '  Carlos  ' },
    );
    expect(propiedades).toEqual([]);
    expect(dto.nombre).toBe('Carlos');
  });

  it.each(['', '   ', undefined, 42])(
    'rechaza un nombre vacio o que no es texto (%p)',
    async (nombre) => {
      const { propiedades } = await propiedadesConError(
        UpdateClientProfileDto,
        { nombre },
      );
      expect(propiedades).toContain('nombre');
    },
  );

  it('rechaza un nombre de mas de 255 caracteres', async () => {
    const { propiedades } = await propiedadesConError(UpdateClientProfileDto, {
      nombre: 'a'.repeat(256),
    });
    expect(propiedades).toContain('nombre');
  });
});

describe('ChangeClientPasswordDto', () => {
  it('acepta una actual cualquiera y una nueva con letra y numero', async () => {
    const { propiedades } = await propiedadesConError(ChangeClientPasswordDto, {
      actual: 'x',
      nueva: 'nueva12345',
    });
    expect(propiedades).toEqual([]);
  });

  it('exige la actual', async () => {
    for (const actual of ['', undefined, 123]) {
      const { propiedades } = await propiedadesConError(
        ChangeClientPasswordDto,
        { actual, nueva: 'nueva12345' },
      );
      expect(propiedades).toContain('actual');
    }
  });

  it('aplica a la nueva las reglas del registro', async () => {
    for (const nueva of [
      'corta1',
      'sinnumeroaqui',
      '1234567890',
      `a1${'x'.repeat(71)}`,
    ]) {
      const { propiedades } = await propiedadesConError(
        ChangeClientPasswordDto,
        { actual: 'vieja1234', nueva },
      );
      expect(propiedades).toContain('nueva');
    }
  });
});
