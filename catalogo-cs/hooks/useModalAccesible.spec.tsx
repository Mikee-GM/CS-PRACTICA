/** @jest-environment jsdom */

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { useModalAccesible } from "./useModalAccesible";

// jsdom no calcula cajas: sin esto `getClientRects()` queda vacio y el hook
// descartaria todos los controles por considerarlos ocultos.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{}];
    },
  });
});

function Modal({
  onCerrar,
  bloqueado = false,
  etiqueta = "modal",
}: {
  onCerrar: () => void;
  bloqueado?: boolean;
  etiqueta?: string;
}) {
  const panel = useModalAccesible<HTMLDivElement>({ onCerrar, bloqueado });
  return (
    <div ref={panel} role="dialog" aria-label={etiqueta}>
      <button type="button">Primero {etiqueta}</button>
      <button type="button">Ultimo {etiqueta}</button>
    </div>
  );
}

function Pantalla({ onCerrar }: { onCerrar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>
        Abrir
      </button>
      {abierto ? (
        <Modal
          onCerrar={() => {
            onCerrar();
            setAbierto(false);
          }}
        />
      ) : null}
    </>
  );
}

it("mueve el foco al primer control al abrir y lo devuelve al cerrar", () => {
  const onCerrar = jest.fn();
  render(<Pantalla onCerrar={onCerrar} />);

  const abrir = screen.getByText("Abrir");
  abrir.focus();
  fireEvent.click(abrir);
  expect(document.activeElement).toBe(screen.getByText("Primero modal"));

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onCerrar).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(abrir);
});

it("no cierra con Esc mientras esta bloqueado", () => {
  const onCerrar = jest.fn();
  render(<Modal onCerrar={onCerrar} bloqueado />);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onCerrar).not.toHaveBeenCalled();
});

it("mantiene el Tab dentro del modal", () => {
  render(<Modal onCerrar={jest.fn()} />);
  const primero = screen.getByText("Primero modal");
  const ultimo = screen.getByText("Ultimo modal");

  ultimo.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(primero);

  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(ultimo);
});

it("con modales anidados, un Esc cierra solo el de encima", () => {
  const cerrarFondo = jest.fn();
  const cerrarSuperior = jest.fn();
  render(
    <>
      <Modal onCerrar={cerrarFondo} etiqueta="fondo" />
      <Modal onCerrar={cerrarSuperior} etiqueta="superior" />
    </>,
  );

  fireEvent.keyDown(document, { key: "Escape" });
  expect(cerrarSuperior).toHaveBeenCalledTimes(1);
  expect(cerrarFondo).not.toHaveBeenCalled();
});
