<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reglas del Proyecto — Colombia Sexys

## Reglas Fundamentales

1. **CERO EMOJIS.** No usar emojis en ningun texto, componente, notificacion, comentario o mensaje de la aplicacion. Esto es absolutamente innegociable.
2. **Profesionalismo total.** El tono de toda la aplicacion debe ser sofisticado, elegante y premium.
3. **Idioma: Espanol.** Toda la interfaz de usuario esta en espanol.
4. **Reutilización de componentes.** Utilizar componentes genéricos siempre que exista la oportunidad (ej. `InputField`, `SearchBar`, `CreateButton`) para evitar la redundancia de código y estilos.

## Tipografia

- **Titulos y encabezados:** Cormorant Garamond (serif, elegante). Pesos: 300, 400, 500, 600, 700.
- **Cuerpo de texto, etiquetas, botones:** Inter (sans-serif, limpia). Pesos: 300, 400, 500, 600, 700.
- **Consistencia absoluta:** Nunca usar fuentes del sistema por defecto. Siempre usar las fuentes definidas.

## Paleta de Colores

- **Negro principal:** #000000
- **Negro suave:** #050505, #0A0A0A
- **Dorado principal:** #C5A55A
- **Dorado claro:** #D4AF37
- **Dorado luminoso:** #E8D5A3
- **Dorado oscuro:** #8B7635
- **Zinc (acentos neutros):** zinc-800, zinc-700, zinc-600, zinc-500
- **Blanco (texto sobre negro):** #FFFFFF, #F5F5F5

## Diseno

- **Mobile-first siempre.** La experiencia en celulares es la prioridad.
- **Scroll natural.** No usar snap-scroll. Scroll normal de toda la vida.
- **Sin fondo blanco.** El fondo siempre es negro o casi negro.
- **Bordes y acentos en dorado.** Los bordes decorativos, hover states, y acentos usan dorado.
- **Botones:** Bordes dorados sobre fondo negro, hover con fondo dorado y texto negro.

## Movimiento

- **El movimiento responde a una accion**: enviar, recibir, abrir, confirmar, un
  error. No decora la carga ni se pone en cada seccion o tarjeta.
- Se usa `framer-motion`. Las piezas del chat viven en
  `components/chat/animaciones.tsx` (entrada de mensaje, "escribiendo", cambio de
  estado del envio); reutilizalas antes de crear otras.
- En el chat solo se anima lo que llega o se envia con la conversacion abierta:
  el historial que ya estaba al abrir se pinta sin movimiento.
- `ProveedorMovimiento` (en `app/layout.tsx`) respeta "reducir movimiento" del
  sistema en toda la aplicacion: apaga las transformaciones y deja la opacidad.
- Skills de diseno instaladas: `frontend-design` y `web-design-guidelines`. Si
  alguna contradice este archivo (fuentes, paleta), manda este archivo.

## Arquitectura

- **Framework:** Next.js (App Router) + React + TypeScript
- **Estilos:** Tailwind CSS 4
- **Animaciones:** Framer Motion
- **Notificaciones:** Sonner

Este paquete **no habla con ninguna base de datos**. Toda la persistencia, la
autenticacion y la subida de archivos viven en el backend NestJS
(PostgreSQL + TypeORM, JWT en cookies firmadas, Cloudflare R2). El navegador
tampoco habla directo con NestJS: `middleware.ts` reescribe `/api/*` hacia
`BACKEND_API_URL`, y en el servidor `lib/api-server.ts#apiFetch` reenvia las
cookies y el `x-csrf-token`.

`BACKEND_API_URL` es exclusivamente de servidor. Nunca la expongas al cliente.

Hubo una etapa con Firebase Firestore y Firebase Auth. Se elimino: si encuentras
codigo o documentacion que los mencione, es residuo, no una via alternativa.
