"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { direccionDeLaPestana, indiceDePestana } from "@/lib/pestanas-del-cliente";

/**
 * La pestana que se vio por ultima vez en esta sesion del navegador. Vive fuera
 * del componente porque cada pagina monta una instancia nueva: la navegacion del
 * cliente conserva el modulo, asi que sirve para saber de donde se viene.
 */
let pestanaPrevia: number | null = null;

/**
 * Envuelve el contenido de una pestana del area del cliente (publicaciones,
 * chats, perfil) para que entre desplazandose desde el lado en que esta la
 * pestana de origen: ir a la derecha en la barra trae la pantalla desde la
 * derecha, y al reves.
 *
 * Solo anima la entrada: Next desmonta la pagina anterior al navegar, y mantenerla
 * para animar su salida obligaria a duplicar los datos de cada pantalla. En la
 * primera carga, o al llegar desde fuera de la barra, no hay movimiento.
 *
 * `ProveedorMovimiento` apaga el desplazamiento si el sistema pide reducir el
 * movimiento. Se anima solo `x` y la opacidad: al terminar, el contenido queda sin
 * `transform`, asi que no afecta a nada con `position: fixed` dentro.
 */
export default function TransicionDePestana({ children }: { children: ReactNode }) {
  const ruta = usePathname() ?? "";
  const [direccion] = useState(() => {
    const actual = indiceDePestana(ruta);
    const d = direccionDeLaPestana(pestanaPrevia, actual);
    pestanaPrevia = actual;
    return d;
  });

  return (
    // `overflow-x-clip` evita la barra de desplazamiento horizontal mientras el
    // contenido entra desde fuera de la pantalla.
    <div className="overflow-x-clip">
      <motion.div
        initial={direccion === 0 ? false : { x: direccion * 56, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
}
