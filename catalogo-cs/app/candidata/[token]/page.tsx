import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AuthShell from "@/components/cliente/AuthShell";
import EvaluacionCandidata from "@/components/candidata/EvaluacionCandidata";
import { TOKEN_CANDIDATA } from "@/lib/candidata";

export const metadata: Metadata = {
  title: "Evaluación | Colombia Sexys",
  robots: { index: false },
  // El token viaja en la URL: que no se filtre en la cabecera Referer.
  referrer: "no-referrer",
};

export default async function CandidataPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!TOKEN_CANDIDATA.test(token)) notFound();

  return (
    <AuthShell etiqueta="Colombia Sexys" titulo="Evaluación">
      <EvaluacionCandidata token={token} />
    </AuthShell>
  );
}
