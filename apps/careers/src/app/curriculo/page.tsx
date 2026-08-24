import Link from "next/link";
import { prisma } from "@/server/lib/prisma";
import { ResumeUploadForm } from "@/components/resume-upload-form";
import { ResumeEditor } from "@/components/resume-editor";
import { ContextLibrary } from "@/components/context-library";
import { setDefaultResume } from "@/server/modules/resumes/actions";
import { cn } from "@/lib/utils";
import type { JSONContent } from "@tiptap/react";

export const dynamic = "force-dynamic";

export default async function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const [resumes, contextDocs] = await Promise.all([
    prisma.resumeVersion.findMany({ orderBy: [{ label: "asc" }, { version: "desc" }] }),
    prisma.contextDocument.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const active = resumes.find((r) => r.id === v) ?? resumes.find((r) => r.isDefault) ?? resumes[0];

  const byLabel = new Map<string, typeof resumes>();
  for (const r of resumes) {
    const list = byLabel.get(r.label) ?? [];
    list.push(r);
    byLabel.set(r.label, list);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Currículo</span>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[300px] shrink-0 overflow-auto border-r border-border p-5">
          <div className="mb-3 text-sm font-semibold">Versões</div>
          <div className="flex flex-col gap-3">
            {[...byLabel.entries()].map(([label, versions]) => (
              <div key={label} className="rounded-xl border border-border bg-card p-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{label}</span>
                  {versions.some((v2) => v2.isDefault) && (
                    <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                      ATIVA
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {versions.map((ver) => (
                    <Link
                      key={ver.id}
                      href={`/curriculo?v=${ver.id}`}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-secondary",
                        active?.id === ver.id && "bg-secondary"
                      )}
                    >
                      <span className="w-6 font-semibold">v{ver.version}</span>
                      <span className="flex-1 truncate text-muted-foreground">{ver.notes ?? "—"}</span>
                      <span className="text-muted-foreground">{ver.updatedAt.toLocaleDateString("pt-BR")}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {resumes.length === 0 && <p className="text-xs text-muted-foreground">Nenhum currículo enviado ainda.</p>}
          </div>
          <div className="mt-4">
            <ResumeUploadForm />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {active ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">
                    {active.label} — v{active.version}
                  </div>
                  <div className="text-xs text-muted-foreground">{active.originalName}</div>
                </div>
                {!active.isDefault && (
                  <form action={setDefaultResume.bind(null, active.id)}>
                    <button
                      type="submit"
                      className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80"
                    >
                      Marcar como ativa
                    </button>
                  </form>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <ResumeEditor resumeId={active.id} content={(active.contentJson as JSONContent) ?? { type: "doc", content: [] }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Envie um currículo para começar a editar.</p>
          )}
        </div>

        <div className="w-[360px] shrink-0 overflow-auto border-l border-border p-5">
          <div className="mb-3 text-sm font-semibold">Biblioteca de contexto</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Só o que estiver marcado &ldquo;no prompt&rdquo; entra nas sugestões — nada entra sozinho.
          </p>
          <ContextLibrary docs={contextDocs} />
        </div>
      </div>
    </div>
  );
}
