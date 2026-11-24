"use client";

import { useEffect, useRef } from "react";

/**
 * Ajusta un contenedor a pantalla completa al area que de verdad se ve.
 *
 * En iOS Safari el teclado no encoge el viewport del diseno: lo tapa y, para no
 * esconder el campo enfocado, desplaza la pagina. El resultado era el encabezado
 * empujado hacia abajo y la barra de escritura cortada por abajo.
 *
 * Se arregla sin pelear con el navegador: la pagina de atras queda fija (no hay
 * nada que desplazar) y el contenedor mide exactamente el alto visible
 * (`visualViewport.height`), asi el campo enfocado ya esta a la vista y iOS no
 * tiene motivo para moverlo. Una version anterior ademas movia el contenedor con
 * `translateY` y forzaba `scrollTo(0, 0)`: iOS desplazaba para mostrar el cursor,
 * el codigo lo deshacia, y la pantalla entraba en un bucle de bajadas.
 *
 * Sin `visualViewport` (navegadores viejos) no hace nada y vale el `h-dvh`.
 */
export function useAreaVisible<T extends HTMLElement>(alAjustar?: () => void) {
  const ref = useRef<T>(null);
  const alAjustarRef = useRef(alAjustar);
  useEffect(() => {
    alAjustarRef.current = alAjustar;
  }, [alAjustar]);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    const html = document.documentElement;
    const body = document.body;
    const previo = {
      html: html.style.cssText,
      body: body.style.cssText,
    };
    html.style.overflow = "hidden";
    body.style.cssText +=
      ";position:fixed;inset:0;width:100%;overflow:hidden;overscroll-behavior:none";

    let alturaPrevia = -1;
    const ajustar = () => {
      const altura = Math.round(vv.height);
      // Una ventana oculta o recien creada puede informar 0: no es un alto real.
      if (altura < 200 || altura === alturaPrevia) return;
      alturaPrevia = altura;
      el.style.height = `${altura}px`;
      // Con el teclado abierto no hay indicador de inicio debajo de la barra: el
      // relleno del area segura solo deja un hueco entre ella y el teclado.
      const tecladoAbierto = window.innerHeight - altura > 120;
      el.style.setProperty(
        "--inset-inferior",
        tecladoAbierto ? "0px" : "env(safe-area-inset-bottom)",
      );
      alAjustarRef.current?.();
    };
    ajustar();
    vv.addEventListener("resize", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      el.style.height = "";
      html.style.cssText = previo.html;
      body.style.cssText = previo.body;
    };
  }, []);

  return ref;
}
