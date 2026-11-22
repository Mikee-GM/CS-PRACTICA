/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import InputField from "./InputField";
import SelectField from "./SelectField";
import TextareaField from "./TextareaField";

// El rotulo tiene que nombrar al control: sin la asociacion `for`/`id`, un
// lector de pantalla anunciaba un campo sin nombre y tocar el rotulo no daba foco.
it("InputField asocia su rotulo con el input", () => {
  render(<InputField label="Correo" type="email" />);
  expect(screen.getByLabelText("Correo").tagName).toBe("INPUT");
});

it("InputField respeta un id propio", () => {
  render(<InputField label="Correo" id="correo-admin" />);
  expect(screen.getByLabelText("Correo").id).toBe("correo-admin");
});

it("SelectField asocia su rotulo con el select", () => {
  render(
    <SelectField
      label="Metodo de pago"
      options={[{ value: "efectivo", label: "Efectivo" }]}
    />,
  );
  expect(screen.getByLabelText("Metodo de pago").tagName).toBe("SELECT");
});

it("TextareaField asocia su rotulo con el textarea", () => {
  render(<TextareaField label="Notas" value="" onChange={() => {}} />);
  expect(screen.getByLabelText("Notas").tagName).toBe("TEXTAREA");
});

it("dos campos con el mismo rotulo no comparten id", () => {
  render(
    <>
      <InputField label="Nombre" />
      <InputField label="Nombre" />
    </>,
  );
  const [a, b] = screen.getAllByLabelText("Nombre");
  expect(a.id).not.toBe(b.id);
});
