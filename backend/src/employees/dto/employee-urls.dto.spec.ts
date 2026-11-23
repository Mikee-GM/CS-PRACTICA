import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateEmployeeDto } from './update-employee.dto';

/**
 * El enlace de X y las fotos se pintan como `href` o `src` en la ficha publica.
 * Con `javascript:` o `data:` ejecutarian codigo en el navegador del cliente.
 */
describe('UpdateEmployeeDto: URLs que se pintan en la ficha publica', () => {
  const errores = async (datos: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateEmployeeDto, datos))).map(
      (e) => e.property,
    );

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'sin protocolo.com',
  ])('rechaza %s en linkX, fotoPerfilUrl y fotosExtra', async (valor) => {
    expect(await errores({ linkX: valor })).toContain('linkX');
    expect(await errores({ fotoPerfilUrl: valor })).toContain('fotoPerfilUrl');
    expect(await errores({ fotosExtra: [valor] })).toContain('fotosExtra');
  });

  it('acepta http y https, incluido localhost del entorno local', async () => {
    expect(
      await errores({
        linkX: 'https://x.com/valentina',
        fotoPerfilUrl: 'http://localhost:9000/colombia-sexys/a.png',
        fotosExtra: ['https://media.example.com/b.jpg'],
      }),
    ).toEqual([]);
  });

  it('deja pasar null y vacio (el formulario los manda para borrar el enlace)', async () => {
    expect(await errores({ linkX: null })).toEqual([]);
    expect(await errores({})).toEqual([]);
  });
});
