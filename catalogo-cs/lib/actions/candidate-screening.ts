"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api-server";
import { ejecutarAccion } from "@/lib/ejecutar-accion";
import type { ResultadoAccion } from "@/lib/resultado-accion";
import type {
  CandidateScreening,
  CandidateScreeningStatus,
  ScreeningQuestion,
} from "@/lib/types";

export async function getScreeningQuestions() {
  return apiFetch<ScreeningQuestion[]>("/candidate-screening/questions");
}

export async function createScreeningQuestion(
  data: string | { text: string; options?: Array<{ text: string; isCorrect?: boolean }> },
): Promise<ResultadoAccion<ScreeningQuestion>> {
  const payload = typeof data === "string" ? { text: data } : data;
  return ejecutarAccion(async () => {
    const question = await apiFetch<ScreeningQuestion>(
      "/candidate-screening/questions",
      { method: "POST", body: JSON.stringify(payload) },
    );
    revalidatePath("/admin/candidatas");
    return question;
  }, "No se pudo agregar la pregunta.");
}

export async function updateScreeningQuestion(
  id: string,
  data: {
    text?: string;
    active?: boolean;
    options?: Array<{ text: string; isCorrect?: boolean }>;
  },
): Promise<ResultadoAccion<ScreeningQuestion>> {
  return ejecutarAccion(async () => {
    const question = await apiFetch<ScreeningQuestion>(
      `/candidate-screening/questions/${id}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
    revalidatePath("/admin/candidatas");
    return question;
  }, "No se pudo actualizar la pregunta.");
}

export async function deleteScreeningQuestion(
  id: string,
): Promise<ResultadoAccion<void>> {
  return ejecutarAccion(async () => {
    await apiFetch<void>(`/candidate-screening/questions/${id}`, {
      method: "DELETE",
    });
    revalidatePath("/admin/candidatas");
  }, "No se pudo eliminar la pregunta.");
}

export async function reorderScreeningQuestions(
  questionIds: string[],
): Promise<ResultadoAccion<ScreeningQuestion[]>> {
  return ejecutarAccion(async () => {
    const questions = await apiFetch<ScreeningQuestion[]>(
      "/candidate-screening/questions/reorder",
      { method: "POST", body: JSON.stringify({ questionIds }) },
    );
    revalidatePath("/admin/candidatas");
    return questions;
  }, "No se pudo reordenar las preguntas.");
}

export async function getCandidateScreenings(status?: CandidateScreeningStatus) {
  const query = status ? `?status=${status}` : "";
  return apiFetch<CandidateScreening[]>(`/candidate-screening${query}`);
}

export async function getCandidateScreening(id: string) {
  return apiFetch<CandidateScreening>(`/candidate-screening/${id}`);
}

export async function createCandidateScreening(data: {
  candidateName: string;
  candidatePhone?: string;
  questionIds: string[];
}): Promise<ResultadoAccion<CandidateScreening>> {
  return ejecutarAccion(async () => {
    const screening = await apiFetch<CandidateScreening>("/candidate-screening", {
      method: "POST",
      body: JSON.stringify(data),
    });
    revalidatePath("/admin/candidatas");
    return screening;
  }, "No se pudo crear la evaluacion.");
}

export async function promoteCandidateScreening(
  id: string,
  employeeId: string,
): Promise<ResultadoAccion<CandidateScreening>> {
  return ejecutarAccion(async () => {
    const screening = await apiFetch<CandidateScreening>(
      `/candidate-screening/${id}/promote`,
      { method: "PATCH", body: JSON.stringify({ employeeId }) },
    );
    revalidatePath("/admin/candidatas");
    revalidatePath(`/admin/candidatas/${id}`);
    return screening;
  }, "No se pudo asociar la candidata a la empleada.");
}
