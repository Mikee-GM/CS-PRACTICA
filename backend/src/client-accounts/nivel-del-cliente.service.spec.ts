import {
  calcularNivel,
  NivelDelClienteService,
} from './nivel-del-cliente.service';

/*
 * El nivel esta sin definir por el dueño. Si esta prueba falla es porque
 * alguien cambio la regla: tiene que ser una decision tomada, no un efecto
 * colateral.
 */
describe('calcularNivel', () => {
  it.each([
    { serviciosFinalizados: 0, calificacion: null, miembroDesde: new Date() },
    {
      serviciosFinalizados: 250,
      calificacion: 5,
      miembroDesde: new Date('2020-01-01T00:00:00Z'),
    },
    { serviciosFinalizados: 3, calificacion: 1.2, miembroDesde: new Date() },
  ])('devuelve siempre el nivel inicial (%#)', (entrada) => {
    expect(calcularNivel(entrada)).toEqual({
      codigo: 'inicial',
      nombre: 'Inicial',
    });
  });

  it('el servicio delega en la funcion pura', () => {
    expect(
      new NivelDelClienteService().de({
        serviciosFinalizados: 10,
        calificacion: 4.5,
        miembroDesde: new Date(),
      }),
    ).toEqual({ codigo: 'inicial', nombre: 'Inicial' });
  });
});
