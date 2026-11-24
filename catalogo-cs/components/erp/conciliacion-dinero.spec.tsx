/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  gruposDelResumen,
  textoDeEstado,
  type Conciliacion,
  type ResumenDeDinero,
} from "@/lib/conciliacion";

// La accion del servidor importa `next/headers`; aqui solo se pinta el bloque.
jest.mock("@/lib/actions/conciliacion", () => ({
  resincronizarServicio: jest.fn(),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { bloquesDeConciliacion } from "./conciliacion-dinero";

const RESUMEN: ResumenDeDinero = {
  servicios: 7,
  cobradoTotal: 31500.5,
  cobradoEnEfectivo: 12000,
  cobradoConTarjeta: 9000.5,
  cobradoPorTransferencia: 10500,
  base: 24000,
  extras: 6500.5,
  extrasConTarjeta: 3200,
  comisionExtrasTarjeta: 480,
  transporteCobradoAlCliente: 1000,
  parteDeLaEmpresa: 9600,
  multasDelPeriodo: 300,
  pagoAChoferes: 840,
  pagoAChoferesLiquidado: 640,
  pagoAChoferesPendiente: 200,
  viajesDeChoferes: 9,
  costoDeUber: 180,
  efectivoPorCobrar: 5383.1,
  efectivoPorCobrarListo: 4000,
  efectivoPorCobrarProvisional: 1383.1,
  obligacionesAbiertas: 3,
  abonosDeEfectivoDelPeriodo: 2116.9,
  deudasAbiertas: 700,
  cortesConfirmados: 2,
  pagadoEnCortes: 8800,
  cortesPorConfirmar: 1,
  porPagarEnCortesPorConfirmar: 4100.5,
  multasDeChoferesSinDescontar: 0,
  resultadoDeLaEmpresa: 9580,
};

const conciliacion = (parcial: Partial<Conciliacion> = {}): Conciliacion => ({
  desde: "2026-11-23",
  hasta: "2026-11-29",
  generadoAt: "2026-11-24T18:00:00.000Z",
  estado: "ok",
  discrepancias: 0,
  resumen: RESUMEN,
  verificaciones: [
    {
      id: "total-del-servicio",
      titulo: "Total del servicio igual a base, extras y transporte",
      descripcion: "El total tiene que ser la suma de sus tres partes.",
      estado: "ok",
      casos: 0,
      diferenciaTotal: 0,
      muestra: [],
    },
  ],
  ...parcial,
});

describe("textoDeEstado", () => {
  it("dice que todo cuadra, o cuantas discrepancias hay", () => {
    expect(textoDeEstado({ estado: "ok", discrepancias: 0 })).toBe("Todo cuadra");
    expect(textoDeEstado({ estado: "discrepancia", discrepancias: 1 })).toBe("1 discrepancia");
    expect(textoDeEstado({ estado: "discrepancia", discrepancias: 4 })).toBe("4 discrepancias");
  });
});

describe("gruposDelResumen", () => {
  it("cubre lo cobrado, el reparto, el transporte, el efectivo y los cortes", () => {
    const ids = gruposDelResumen(RESUMEN).map((g) => g.id);

    expect(ids).toEqual(["cobrado", "composicion", "reparto", "transporte", "efectivo", "cortes"]);
  });

  it("los conteos no se muestran como dinero", () => {
    const filas = gruposDelResumen(RESUMEN).flatMap((g) => g.filas);

    expect(filas.find((f) => f.etiqueta === "Servicios terminados")?.tipo).toBe("cantidad");
    expect(filas.find((f) => f.etiqueta === "Viajes de choferes")?.tipo).toBe("cantidad");
  });

  it("avisa cuando hay multas a choferes que ningun corte descuenta", () => {
    const con = gruposDelResumen({ ...RESUMEN, multasDeChoferesSinDescontar: 600 })
      .flatMap((g) => g.filas)
      .find((f) => f.etiqueta === "Multas a choferes sin descontar");
    const sin = gruposDelResumen(RESUMEN)
      .flatMap((g) => g.filas)
      .find((f) => f.etiqueta === "Multas a choferes sin descontar");

    expect(con?.tono).toBe("aviso");
    expect(sin?.tono).toBe("normal");
  });
});

describe("bloquesDeConciliacion", () => {
  it("sin datos deja un aviso en vez de ocultar el bloque", () => {
    const [bloque] = bloquesDeConciliacion(null);
    render(<>{bloque.contenido}</>);

    expect(screen.getByText(/No se pudo calcular la conciliacion/)).toBeTruthy();
  });

  it("con todo cuadrado muestra el resultado de la empresa y 'Todo cuadra'", () => {
    const bloques = bloquesDeConciliacion(conciliacion());
    render(
      <>
        {bloques.map((b) => (
          <div key={b.id}>{b.contenido}</div>
        ))}
      </>,
    );

    expect(bloques.map((b) => b.id)).toEqual(["dinero-desglose", "conciliacion-dinero"]);
    expect(screen.getByText("Resultado estimado de la empresa")).toBeTruthy();
    expect(screen.getByText("Todo cuadra")).toBeTruthy();
    expect(screen.getByText("Cuadra")).toBeTruthy();
  });

  it("con una discrepancia la muestra con sus importes y el boton de regenerar", () => {
    const bloques = bloquesDeConciliacion(
      conciliacion({
        estado: "discrepancia",
        discrepancias: 1,
        verificaciones: [
          {
            id: "registro-base",
            titulo: "Registro de liquidacion: base del servicio",
            descripcion: "El importe del servicio en el corte tiene que ser el del servicio.",
            estado: "discrepancia",
            casos: 1,
            diferenciaTotal: 3900,
            muestra: [
              {
                referencia: "servicio deadbeef",
                servicioId: "deadbeef-0000-4000-8000-000000000070",
                esperado: 5000,
                real: 8900,
                diferencia: 3900,
                detalle: "el registro quedo con otro importe que el servicio",
              },
            ],
          },
        ],
      }),
    );
    render(<>{bloques[1].contenido}</>);

    expect(screen.getByText("1 discrepancia")).toBeTruthy();
    expect(screen.getByText("servicio deadbeef")).toBeTruthy();
    expect(screen.getByText("Regenerar registro")).toBeTruthy();
  });

  it("no ofrece regenerar en una discrepancia que necesita decision de una persona", () => {
    const bloques = bloquesDeConciliacion(
      conciliacion({
        estado: "discrepancia",
        discrepancias: 1,
        verificaciones: [
          {
            id: "obligacion-estado",
            titulo: "Obligaciones: estado coherente con lo pagado",
            descripcion: "Una obligacion esta pagada si y solo si lo pagado alcanza su importe.",
            estado: "discrepancia",
            casos: 1,
            diferenciaTotal: 10,
            muestra: [
              {
                referencia: "obligacion deadbeef",
                servicioId: "deadbeef-0000-4000-8000-000000000071",
                esperado: 100,
                real: 110,
                diferencia: 10,
                detalle: "estado pending",
              },
            ],
          },
        ],
      }),
    );
    render(<>{bloques[1].contenido}</>);

    expect(screen.queryByText("Regenerar registro")).toBeNull();
  });
});
