"use client";

import * as React from "react";
import type { JSONContent } from "@tiptap/react";
import { TiptapEditor } from "@/components/tiptap-editor";
import { saveResumeContent } from "@/server/modules/resumes/actions";

export function ResumeEditor({ resumeId, content }: { resumeId: string; content: JSONContent }) {
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        {savedAt && (
          <span className="text-[11px] text-muted-foreground">salvo às {savedAt.toLocaleTimeString("pt-BR")}</span>
        )}
      </div>
      <TiptapEditor
        key={resumeId}
        content={content}
        onSave={async (json, text) => {
          await saveResumeContent(resumeId, json, text);
          setSavedAt(new Date());
        }}
      />
    </div>
  );
}
