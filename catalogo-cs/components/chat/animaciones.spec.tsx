/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  EstadoAnimado,
  IndicadorEscribiendo,
  ItemMensaje,
  ProveedorMovimiento,
} from "./animaciones";

describe("IndicadorEscribiendo", () => {
  it("anuncia el texto y no los puntos decorativos", () => {
    const { container } = render(
      <IndicadorEscribiendo visible texto="Valentina está escribiendo" />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Valentina está escribiendo",
    );
    // Los tres puntos viven en un contenedor oculto al lector de pantalla.
    const decorativo = container.querySelector('[aria-hidden="true"]');
    expect(decorativo?.children).toHaveLength(3);
  });

  it("deja el estado vacio, pero presente, cuando nadie escribe", () => {
    render(<IndicadorEscribiendo visible={false} texto="Valentina está escribiendo" />);

    // El contenedor `role=status` se queda para que el lector anuncie los
    // cambios y la lista no salte de altura.
    const estado = screen.getByRole("status");
    expect(estado.childElementCount).toBe(0);
    expect(estado.textContent).toBe("");
    expect(estado.classList.contains("min-h-7")).toBe(true);
  });
});

describe("ItemMensaje", () => {
  it("pinta el mensaje como un elemento de lista", () => {
    render(
      <ul>
        <ItemMensaje lado="derecha" animar className="flex justify-end">
          <span>Hola</span>
        </ItemMensaje>
      </ul>,
    );

    const item = screen.getByRole("listitem");
    expect(item.textContent).toBe("Hola");
    expect(item.classList.contains("justify-end")).toBe(true);
  });

  it("sin animar, el historial se pinta ya en su sitio y visible", () => {
    render(
      <ul>
        <ItemMensaje lado="izquierda" animar={false}>
          <span>Anterior</span>
        </ItemMensaje>
      </ul>,
    );

    // Con `initial={false}` no hay estado de partida: nada de opacidad 0.
    expect(screen.getByRole("listitem").style.opacity).not.toBe("0");
  });
});

describe("EstadoAnimado y ProveedorMovimiento", () => {
  it("muestra el contenido del estado actual", () => {
    render(
      <ProveedorMovimiento>
        <EstadoAnimado clave="enviando">Enviando</EstadoAnimado>
      </ProveedorMovimiento>,
    );

    expect(screen.getByText("Enviando")).toBeTruthy();
  });
});
