# Lista manual: personal sin Telegram

Comprobaciones en navegador que el e2e no cubre. Hacerlas con una empleada y un
chofer cuyo `telegram_chat_id` sea nulo, contra un entorno con el frontend y el
backend levantados.

- [ ] Entrar por `/ingresar` como empleada con correo y contrasena: aterriza en
      su portal.
- [ ] Entrar por `/ingresar` como chofer: aterriza en su portal.
- [ ] Abrir `/empleada/portal` y `/chofer/portal` sin sesion: ambos mandan a
      `/ingresar`.
- [ ] Abrir `/empleada/portal?token=x` sin sesion: manda a `/ingresar` y no
      intenta canjear el token.
- [ ] `/acceso/x` responde 404.
- [ ] Con un servicio de prueba, la empleada y el chofer reciben el push de cada
      avance (oferta, aceptacion, llegada, cierre).
- [ ] El panel del jefe y los portales reciben los eventos SSE en vivo sin
      recargar.
- [ ] El comando `/portal` del bot de Telegram responde con un enlace normal al
      sitio, sin token ni credencial en la URL, y con el texto "Entra con tu
      correo y contrasena".
