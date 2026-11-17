import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterClientDto } from './dto/register-client.dto';

const valido = {
  email: '  Cliente@Example.COM ',
  password: 'secreta123',
  mayorDeEdad: true,
  aceptaTerminos: true,
};

async function errores(datos: Record<string, unknown>) {
  const dto = plainToInstance(RegisterClientDto, datos);
  const fallos = await validate(dto);
  return { dto, propiedades: fallos.map((f) => f.property) };
}

describe('RegisterClientDto', () => {
  it('normaliza el correo a minusculas y sin espacios', async () => {
    const { dto, propiedades } = await errores(valido);
    expect(propiedades).toEqual([]);
    expect(dto.email).toBe('cliente@example.com');
  });

  it('exige declarar la mayoria de edad', async () => {
    const { propiedades } = await errores({ ...valido, mayorDeEdad: false });
    expect(propiedades).toContain('mayorDeEdad');
  });

  it('exige aceptar los terminos', async () => {
    const { propiedades } = await errores({ ...valido, aceptaTerminos: false });
    expect(propiedades).toContain('aceptaTerminos');
  });

  it('rechaza contrasenas cortas, sin numero o sin letra', async () => {
    for (const password of ['corta1', 'sinnumeroaqui', '1234567890']) {
      const { propiedades } = await errores({ ...valido, password });
      expect(propiedades).toContain('password');
    }
  });

  it('rechaza contrasenas de mas de 72 caracteres', async () => {
    const { propiedades } = await errores({
      ...valido,
      password: 'a1'.repeat(40),
    });
    expect(propiedades).toContain('password');
  });
});
