"use client";

import { useEffect, useRef } from "react";

/**
 * Ajusta un contenedor a pantalla completa al area que de verdad se ve.
 *
 * En iOS Safari el teclado no encoge el viewport del diseno: lo tapa y, para no
 * esconder el campo enfocado, desplaza la pagina. Si el contenedor se queda en su
 * sitio, el encabezado sale de la pantalla y la barra de escritura queda lejos
 * del teclado.
 *
 * El contenedor se coloca fijo sobre el area visible: `top` es el desplazamiento
 * del visual viewport y `height` su alto, y ambos se actualizan con `resize` y
 * `scroll` del visual viewport. Nunca se fuerza el desplazamiento de la pagina
 * (`scrollTo`) ni se usa `transform`: una version anterior hacia ambas cosas y
 * entraba en un bucle con el desplazamiento que iOS hace para mostrar el cursor.
 * Aqui solo se sigue lo que iOS ya hizo, y como el campo enfocado queda dentro del
 * area visible, iOS no tiene motivo para volver a moverlo.
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
      el: el.style.cssText,
    };
    html.style.overflow = "hidden";
    body.style.cssText +=
      ";position:fixed;inset:0;width:100%;overflow:hidden;overscroll-behavior:none";
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.right = "0";

    let alturaPrevia = -1;
    let topPrevio = -1;
    const ajustar = () => {
      const altura = Math.round(vv.height);
      const top = Math.round(vv.offsetTop);
      // Una ventana oculta o recien creada puede informar 0: no es un alto real.
      if (altura < 200) return;
      if (altura === alturaPrevia && top === topPrevio) return;
      const cambioAltura = altura !== alturaPrevia;
      alturaPrevia = altura;
      topPrevio = top;
      el.style.height = `${altura}px`;
      el.style.top = `${top}px`;
      // Con el teclado abierto no hay indicador de inicio debajo de la barra: el
      // relleno del area segura solo deja un hueco entre ella y el teclado.
      const tecladoAbierto = window.innerHeight - altura > 120;
      el.style.setProperty(
        "--inset-inferior",
        tecladoAbierto ? "0px" : "env(safe-area-inset-bottom)",
      );
      if (cambioAltura) alAjustarRef.current?.();
    };
    ajustar();
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
      el.style.cssText = previo.el;
      html.style.cssText = previo.html;
      body.style.cssText = previo.body;
    };
  }, []);

  return ref;
}
