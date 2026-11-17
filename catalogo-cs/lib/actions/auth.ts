"use server";

import { redirect } from "next/navigation";

import { applyBackendSetCookies } from "@/lib/auth-cookies";
import {
  getBackendCookieHeader,
  getCsrfToken,
  getCurrentUser,
  isRedirectError,
} from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/api-server";
import { destinoTrasEntrar, errorAlGuardarPerfil } from "@/lib/acceso-personal";

/**
 * Inicio de sesion.
 *
 * La navegacion al panel la hace el servidor, no el cliente. Antes esto
 * devolvia la ruta de destino y el formulario la empujaba con `router.push`:
 * eso pide la sesion recien creada en una navegacion aparte, y basta con que
 * las cookies de la respuesta de esta accion no esten aplicadas todavia cuando
 * sale esa peticion para que el middleware no vea la sesion y devuelva al
 * login. Desde fuera se ve como unas credenciales aceptadas que no llevan a
 * ningun sitio.
 *
 * Con `redirect()` la navegacion forma parte de la misma respuesta que trae las
 * cookies, asi que no hay ventana entre una cosa y la otra. Ojo al orden: el
 * redirect va DESPUES de escribirlas, y su excepcion de control no puede caer
 * en el `catch` de abajo --por eso se relanza-- o se tragaria la navegacion y
 * pareceria un error de login.
 */
/*
 * `siguiente` es la pantalla a la que volver tras entrar --el cliente que tocó
 * "Chatear" sin sesion-- y solo vale para el rol cliente y para sus propias
 * pantallas (`destinoSeguroDelCliente`). El personal siempre va a su inicio,
 * salvo que entre con una contraseña temporal: entonces va primero a cambiarla.
 */
export async function loginAction(
  email: string,
  password: string,
  siguiente?: string | null,
) {
  let destino: string | null = null;

  try {
    const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Credenciales incorrectas");
    }

    /*
     * Entran los cuatro roles, no solo admin y jefe.
     *
     * Las modelos y los choferes ya tenian correo y contraseña --se les asignan
     * al darlos de alta-- pero no podian usarlos: su unica via era el enlace
     * con token del bot, que hay que rehacer cada vez que se cierra la sesion.
     * Con esto la aplicacion instalada en su telefono se arregla sola, porque
     * si caduca la sesion basta con volver a entrar.
     *
     * El destino sale de `destinoTrasEntrar`, la misma funcion que usa la
     * pagina del login con la sesion ya abierta: un rol desconocido no tiene
     * destino y no entra, y la marca de contraseña temporal manda primero a
     * cambiarla, en la misma respuesta que trae las cookies.
     */
    const alEntrar = destinoTrasEntrar({
      rol: data.user?.rol,
      debeCambiarPassword: data.user?.debeCambiarPassword,
      siguiente,
    });
    if (!alEntrar) {
      return { success: false, error: "Tu cuenta no tiene acceso a la aplicación" };
    }
    await applyBackendSetCookies(response);
    destino = alEntrar;
  } catch (error: unknown) {
    console.error("loginAction error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error de conexión con el servidor de autenticación",
    };
  }

  redirect(destino);
}

export async function logoutAction() {
  const [cookie, csrfToken] = await Promise.all([
    getBackendCookieHeader(),
    getCsrfToken(),
  ]);
  const response = await fetch(`${getApiBaseUrl()}/auth/logout`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Cookie: cookie,
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
  });
  await applyBackendSetCookies(response);
  return { success: true };
}

export async function checkSessionAction() {
  return getCurrentUser();
}

export async function getMyProfileAction() {
  return getCurrentUser();
}

/**
 * Datos propios del personal: nombre, apellido y telefono.
 *
 * Va a `PATCH /users/me` y no a `PATCH /users/:id`: aquel es de
 * administracion y le respondia 403 a la modelo y al chofer. El correo y la
 * contraseña ya no se cambian aqui: el correo es la identidad de la cuenta y
 * lo cambia administracion, y la contraseña tiene su propio flujo, que pide la
 * actual (`cambiarContrasenaPropiaAction`).
 */
export async function updateMyProfileAction(input: {
  nombre?: string;
  apellido?: string;
  telefono?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const body: Record<string, string> = {};
  if (input.nombre !== undefined) body.nombre = input.nombre.trim();
  if (input.apellido !== undefined) body.apellido = input.apellido.trim();
  if (input.telefono !== undefined) body.telefono = input.telefono.trim();
  if (body.nombre === "" || body.apellido === "") {
    return { success: false, error: errorAlGuardarPerfil(400) };
  }

  try {
    const { apiFetch, ApiError } = await import("@/lib/api-server");
    try {
      await apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return { success: false, error: errorAlGuardarPerfil(error.status) };
      }
      throw error;
    }
    return { success: true };
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    console.error("updateMyProfileAction error:", error);
    return { success: false, error: errorAlGuardarPerfil(null) };
  }
}
