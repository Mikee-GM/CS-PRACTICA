import { apiFetch } from "@/lib/api-server";
import type { PerfilCliente } from "@/lib/perfil-cliente";

/**
 * Perfil del cliente con sesion, en el servidor.
 *
 * Una sesion ausente o caducada manda al login de cliente: con el valor por
 * defecto de `apiFetch` acabaria en el del panel.
 */
export function getPerfilCliente(): Promise<PerfilCliente> {
  return apiFetch<PerfilCliente>("/client-accounts/me/perfil", {
    loginPath: "/ingresar",
  });
}
