import { botonesDePortal, enlaceDelPanel } from './telegram-portal-buttons';

describe('enlaceDelPanel', () => {
  it('une el origen y la ruta sin duplicar barras', () => {
    expect(enlaceDelPanel('https://web.example.com/', '/jefe?tab=grupos')).toBe(
      'https://web.example.com/jefe?tab=grupos',
    );
    expect(enlaceDelPanel('https://web.example.com', 'jefe')).toBe(
      'https://web.example.com/jefe',
    );
  });
});

describe('botonesDePortal', () => {
  it('ofrece solo el boton de navegador, nunca Mini App', () => {
    const filas = botonesDePortal('https://panel.example.com/empleada/portal');

    expect(filas).toHaveLength(1);
    expect(filas[0][0]).toHaveProperty('url');
    expect(filas[0][0]).not.toHaveProperty('web_app');
  });

  it('tambien deja entrar con http', () => {
    const filas = botonesDePortal('http://localhost:3000/chofer/portal', 'X');

    expect(filas).toHaveLength(1);
    expect(filas[0][0]).toHaveProperty('text', 'X');
  });
});
