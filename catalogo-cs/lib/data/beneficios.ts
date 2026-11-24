import { apiFetch } from "@/lib/api-server";
import type { BeneficioDeInstalacion } from "@/lib/beneficios-del-cliente";

/** Estado del descuento por instalar la app, para el cliente con sesion. */
export function getBeneficioDeInstalacion(): Promise<BeneficioDeInstalacion> {
  return apiFetch<BeneficioDeInstalacion>("/client-benefits/app-install", {
    loginPath: "/ingresar",
  });
}
