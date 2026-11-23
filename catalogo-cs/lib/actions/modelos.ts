"use server";

import { isRedirectError } from "@/lib/auth";
import type { Modelo, ModeloPayload } from "@/types";
import { revalidatePath, revalidateTag } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api-server";
import { mapToModelo } from "@/lib/data/modelos-mapper";
import { CATALOG_CACHE_TAG } from "@/lib/data/catalog";

// El catalogo publico se lee con `getCatalogModelos()` desde Server
// Components (ver lib/data/catalog.ts). No se expone como Server Action:
// serian POST secuenciales, no cacheables, y cada export "use server" publica
// un endpoint aunque nadie lo llame.

/**
 * Resultado de crear, editar o borrar una modelo.
 *
 * Next oculta el texto de cualquier excepcion lanzada desde una Server Action en
 * produccion: el usuario veia "An error occurred in the Server Components
 * render" en ingles, sin saber que campo fallo. Por eso el motivo se devuelve
 * como valor, igual que en el resto de acciones.
 */
export type ResultadoModelo =
  | { ok: true; modelo?: Modelo }
  | { ok: false; error: string };

function motivoDelFallo(error: unknown, porDefecto: string): string {
  if (error instanceof ApiError) {
    const mensaje = (error.body as { message?: unknown } | undefined)?.message;
    if (Array.isArray(mensaje)) return mensaje.join(". ");
    if (typeof mensaje === "string" && mensaje) return mensaje;
    return error.message || porDefecto;
  }
  return porDefecto;
}

export async function getModelosAction(
  onlyAvailable = false,
): Promise<Modelo[]> {
  try {
    const data = await apiFetch<any[]>("/employees", {
      authenticated: true,
    });
    let list = data.map(mapToModelo);
    if (onlyAvailable) {
      list = list.filter((m: Modelo) => m.disponible);
    }
    return list;
  } catch (error) {
    console.error("getModelosAction error:", error);
    return [];
  }
}

export async function getModeloAction(id: string): Promise<Modelo> {
  const data = await apiFetch<any>(`/employees/${id}`, {
    authenticated: false,
  });
  return mapToModelo(data);
}

export async function createModeloAction(
  payload: ModeloPayload,
): Promise<ResultadoModelo> {
  const slug = `${payload.nombreArtistico.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString().slice(-4)}`;

  /*
   * Las credenciales las escribe quien da de alta.
   *
   * Antes se inventaban aqui: un correo derivado del nombre artistico y la
   * MISMA contraseña para todas. Mientras el login rechazaba el rol `empleada`
   * daba igual, pero en cuanto se les permitio entrar con correo y contraseña
   * eso se convirtio en una cuenta abierta por cada modelo.
   */
  const createDto = {
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    nombreReal: payload.nombreReal,
    nombreArtistico: payload.nombreArtistico,
    slugCatalogo: slug,
    fotoPerfilUrl: payload.fotoPrincipal,
    descripcion: payload.descripcion,
    estiloHabla: (payload.estiloHabla || "").trim() || undefined,
    politicaBesos: payload.politicaBesos || null,
    precioBaseHora: payload.precioBaseHora,
    disponible: payload.disponible ?? true,
    catalogoActivo: payload.catalogoActivo ?? true,
    jefeId: payload.jefeId || null,
    jefeSecundarioId: payload.jefeSecundarioId || null,
    apartmentId: payload.apartmentId || null,
    linkX: payload.linkX || null,
    contactLabel: payload.contactLabel || null,
    fotosExtra: payload.fotos,
    extras: (payload.extras || []).map((ext) => ({
      nombre: ext.nombre,
      precio: ext.precio,
      modelosVinculadasIds: ext.modelosVinculadasIds || [],
      speechPersonalizado: (ext.speechPersonalizado || "").trim() || undefined,
    })),
  };

  try {
    const data = await apiFetch<any>("/employees", {
      method: "POST",
      body: JSON.stringify(createDto),
      authenticated: true,
    });

    revalidateTag(CATALOG_CACHE_TAG);
    revalidatePath("/");
    revalidatePath("/admin/modelos");
    return { ok: true, modelo: mapToModelo(data) };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: motivoDelFallo(error, "No se pudo crear la modelo.") };
  }
}

export async function updateModeloAction(
  id: string,
  payload: ModeloPayload,
): Promise<ResultadoModelo> {
  const updateDto = {
    // El correo siempre; la contraseña solo si se escribio una nueva, para no
    // pisar la que ya tiene cada vez que se edita otra cosa.
    ...(payload.email?.trim()
      ? { email: payload.email.trim().toLowerCase() }
      : {}),
    ...(payload.password?.trim() ? { password: payload.password.trim() } : {}),
    nombreReal: payload.nombreReal,
    nombreArtistico: payload.nombreArtistico,
    fotoPerfilUrl: payload.fotoPrincipal,
    descripcion: payload.descripcion,
    estiloHabla: (payload.estiloHabla || "").trim() || undefined,
    politicaBesos: payload.politicaBesos || null,
    precioBaseHora: payload.precioBaseHora,
    disponible: payload.disponible,
    catalogoActivo: payload.catalogoActivo,
    jefeId: payload.jefeId || null,
    jefeSecundarioId: payload.jefeSecundarioId || null,
    apartmentId: payload.apartmentId || null,
    linkX: payload.linkX || null,
    contactLabel: payload.contactLabel || null,
    fotosExtra: payload.fotos,
    extras: (payload.extras || []).map((ext) => ({
      nombre: ext.nombre,
      precio: ext.precio,
      modelosVinculadasIds: ext.modelosVinculadasIds || [],
      speechPersonalizado: (ext.speechPersonalizado || "").trim() || undefined,
    })),
  };

  try {
    const data = await apiFetch<any>(`/employees/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updateDto),
      authenticated: true,
    });

    revalidateTag(CATALOG_CACHE_TAG);
    revalidatePath("/");
    revalidatePath("/admin/modelos");
    return { ok: true, modelo: mapToModelo(data) };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: motivoDelFallo(error, "No se pudo guardar la modelo.") };
  }
}

export async function deleteModeloAction(id: string): Promise<ResultadoModelo> {
  try {
    await apiFetch<void>(`/employees/${id}`, {
      method: "DELETE",
      authenticated: true,
    });

    revalidateTag(CATALOG_CACHE_TAG);
    revalidatePath("/");
    revalidatePath("/admin/modelos");
    return { ok: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: motivoDelFallo(error, "No se pudo eliminar la modelo.") };
  }
}

// TODO: verificar si GET /users?rol=jefe existe en el backend o si hay un endpoint especifico para listar jefes
export async function getJefesAction(): Promise<
  { id: string; email: string }[]
> {
  try {
    const users = await apiFetch<any[]>("/users?rol=jefe", {
      authenticated: true,
    });
    return users.map((u: any) => ({ id: u.id, email: u.email }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("getJefesAction error:", error);
    return [];
  }
}

// TODO: verificar si el modulo /apartments existe en el backend antes de usar esta accion
export async function getApartmentsAction(): Promise<
  { id: string; name: string }[]
> {
  try {
    const apartments = await apiFetch<any[]>("/apartments", {
      authenticated: true,
    });
    return apartments.map((a: any) => ({
      id: a.id,
      name: a.nombre || `Apto ${a.nombre || a.id}`,
    }));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("getApartmentsAction error:", error);
    return [];
  }
}

// --- FOTOS EXCLUSIVAS (CLIENTES) ---

export async function getPrivatePhotosAction(
  empleadaId: string,
): Promise<{ id: string; url: string; orden: number }[]> {
  try {
    return await apiFetch<any[]>(`/employee-photos/private/${empleadaId}`, {
      authenticated: true,
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("getPrivatePhotosAction error:", error);
    return [];
  }
}

export async function addPrivatePhotoAction(
  empleadaId: string,
  url: string,
  orden = 0,
): Promise<any> {
  const data = await apiFetch<any>("/employee-photos/private", {
    method: "POST",
    body: JSON.stringify({ empleadaId, url, orden }),
    authenticated: true,
  });
  revalidatePath("/admin/modelos");
  return data;
}

export async function deletePrivatePhotoAction(id: string): Promise<void> {
  await apiFetch<void>(`/employee-photos/private/${id}`, {
    method: "DELETE",
    authenticated: true,
  });
  revalidatePath("/admin/modelos");
}

// --- GALERIAS: PUBLICAS Y EXCLUSIVAS ---

/** Las dos galerias de una modelo, tal como las nombra el backend. */
export type PhotoGallery = "publica" | "exclusiva";

export async function getGalleryAction(
  empleadaId: string,
  gallery: PhotoGallery,
): Promise<{ id: string; url: string; orden: number }[]> {
  try {
    const path =
      gallery === "publica"
        ? `/employees/${empleadaId}`
        : `/employee-photos/private/${empleadaId}`;

    if (gallery === "exclusiva") {
      return await apiFetch<any[]>(path, { authenticated: true });
    }

    const empleada = await apiFetch<any>(path, { authenticated: true });
    return (empleada?.empleadaFotos ?? []).toSorted(
      (a: { orden?: number }, b: { orden?: number }) => (a.orden ?? 0) - (b.orden ?? 0),
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("getGalleryAction error:", error);
    return [];
  }
}

export async function addGalleryPhotoAction(
  empleadaId: string,
  gallery: PhotoGallery,
  url: string,
  orden = 0,
) {
  const path =
    gallery === "publica" ? "/employee-photos" : "/employee-photos/private";
  const data = await apiFetch<any>(path, {
    method: "POST",
    body: JSON.stringify({ empleadaId, url, orden }),
    authenticated: true,
  });
  revalidateGalleries();
  return data;
}

export async function deleteGalleryPhotoAction(
  id: string,
  gallery: PhotoGallery,
): Promise<void> {
  const path =
    gallery === "publica"
      ? `/employee-photos/${id}`
      : `/employee-photos/private/${id}`;
  await apiFetch<void>(path, { method: "DELETE", authenticated: true });
  revalidateGalleries();
}

/**
 * Reescribe el orden completo de una galeria. Se manda la lista entera porque
 * mover una foto recoloca a todas las demas.
 */
export async function reorderGalleryAction(
  empleadaId: string,
  gallery: PhotoGallery,
  ids: string[],
): Promise<void> {
  await apiFetch<void>("/employee-photos/gallery/reorder", {
    method: "PATCH",
    body: JSON.stringify({ empleadaId, gallery, ids }),
    authenticated: true,
  });
  revalidateGalleries();
}

/** Pasa una foto de publica a exclusiva o al reves, sin volver a subirla. */
export async function movePhotoAction(
  id: string,
  from: PhotoGallery,
  to: PhotoGallery,
): Promise<void> {
  await apiFetch<void>(`/employee-photos/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ from, to }),
    authenticated: true,
  });
  revalidateGalleries();
}

function revalidateGalleries() {
  revalidatePath("/admin/modelos");
  revalidatePath("/admin/fotos");
}

// --- CONTENIDO SEMANAL (VALIDAR CONTENIDO SEMANAL) ---

export async function getWeeklySubmissionsAction(
  empleadaId: string,
  onlyPending = false,
): Promise<any[]> {
  try {
    return await apiFetch<any[]>(
      `/weekly-content/employee/${empleadaId}?onlyPending=${onlyPending}`,
      { authenticated: true },
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("getWeeklySubmissionsAction error:", error);
    return [];
  }
}

/**
 * Igual que la cola de /admin/fotos, pero desde la ficha de la modelo. El
 * motivo del rechazo se acepta aqui tambien: rechazar desde un sitio con
 * explicacion y desde el otro sin ella dejaria a la modelo sin saber por que
 * segun donde estuviera mirando quien revisa.
 */
export async function reviewWeeklySubmissionAction(
  submissionId: string,
  action: "aprobar_publica" | "aprobar_privada" | "rechazar",
  motivo?: string,
): Promise<any> {
  const data = await apiFetch<any>(
    `/weekly-content/submissions/${submissionId}/review`,
    {
      method: "POST",
      body: JSON.stringify({ action, motivo }),
      authenticated: true,
    },
  );
  revalidateTag(CATALOG_CACHE_TAG);
  revalidatePath("/");
  revalidatePath("/admin/modelos");
  return data;
}
