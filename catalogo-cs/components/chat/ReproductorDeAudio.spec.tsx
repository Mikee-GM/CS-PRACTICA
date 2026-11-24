/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import ReproductorDeAudio from "./ReproductorDeAudio";

describe("ReproductorDeAudio", () => {
  it("muestra la duracion del mensaje aunque el archivo no la traiga", () => {
    render(<ReproductorDeAudio url="blob:prueba" durationMs={65_000} />);
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reproducir nota de voz" })).toBeTruthy();
  });

  it("no rompe sin duracion", () => {
    render(<ReproductorDeAudio url="blob:prueba" />);
    expect(screen.getByText("0:00")).toBeTruthy();
  });
});
