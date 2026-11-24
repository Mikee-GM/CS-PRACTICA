/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import AvisoDeIntermediacion, { TEXTO_DE_INTERMEDIACION } from "./AvisoDeIntermediacion";

describe("AvisoDeIntermediacion", () => {
  it("dice que es solo un servicio de intermediacion", () => {
    render(<AvisoDeIntermediacion />);
    expect(screen.getByText(TEXTO_DE_INTERMEDIACION)).toBeTruthy();
    expect(TEXTO_DE_INTERMEDIACION).toMatch(/intermediaria/);
    expect(TEXTO_DE_INTERMEDIACION).toMatch(/no es una aplicación propia/i);
  });
});
