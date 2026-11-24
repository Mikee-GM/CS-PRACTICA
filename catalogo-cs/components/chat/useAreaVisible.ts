"use client";

import { useEffect, useRef } from "react";

/**
 * Ajusta un contenedor a pantalla completa al area que de verdad se ve.
 *
 * En iOS Safari el teclado no encoge el viewport del diseno: lo tapa y, para no
 * esconder el campo enfocado, desplaza la pagina. El resultado es el encabezado
 * empujado hacia abajo con un hueco negro encima y la barra de escritura cortada
 * por abajo. `visualViewport` si da el area visible: se fija el contenedor a su
 * altura y a su desplazamiento, y se impide que la pagina de atras se mueva.
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
      html: html.style.overflow,
      body: body.style.overflow,
      overscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    const ajustar = () => {
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
      // Con el teclado abierto no hay indicador de inicio debajo de la barra: el
      // relleno del area segura solo deja un hueco entre ella y el teclado.
      const tecladoAbierto = window.innerHeight - vv.height > 120;
      el.style.setProperty("--inset-inferior", tecladoAbierto ? "0px" : "env(safe-area-inset-bottom)");
      // La pagina de atras no debe quedarse desplazada tras cerrar el teclado.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      alAjustarRef.current?.();
    };
    ajustar();
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
      el.style.height = "";
      el.style.transform = "";
      html.style.overflow = previo.html;
      body.style.overflow = previo.body;
      body.style.overscrollBehavior = previo.overscroll;
    };
  }, []);

  return ref;
}
