"use client";

import { useActionState } from "react";
import { uploadResume } from "@/server/modules/resumes/actions";

const initialState: { error?: string } = {};

export function ResumeUploadForm() {
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => uploadResume(formData),
    initialState
  );

  return (
    <form action={formAction} className="rounded-xl border border-dashed border-border p-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          name="label"
          placeholder="Trilha (ex: Product, Systems)"
          required
          className="w-48 rounded-lg border border-input bg-background p-2 text-sm outline-none"
        />
        <input
          type="file"
          name="file"
          accept=".pdf,.docx,.md,.txt"
          required
          className="flex-1 text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs"
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "Enviando..." : "Subir currículo"}
        </button>
      </div>
      {state?.error && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">PDF, DOCX, Markdown ou texto — até 10MB.</p>
    </form>
  );
}
