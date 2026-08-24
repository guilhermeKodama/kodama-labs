"use client";

import * as React from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";

export function TiptapEditor({
  content,
  onSave,
  editable = true,
  className,
}: {
  content: JSONContent;
  onSave?: (json: JSONContent, text: string) => void | Promise<void>;
  editable?: boolean;
  className?: string;
}) {
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content,
      editable,
      // Required in the App Router: without this the editor renders once on
      // the server (empty) and once on the client (hydrated content),
      // producing a hydration mismatch. See @tiptap/react's useEditor types
      // — this literal is what unlocks the `Editor | null` overload.
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "prose prose-sm prose-neutral dark:prose-invert max-w-none focus:outline-none min-h-[200px]",
        },
      },
    },
    [editable]
  );

  const saveTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!editor || !onSave) return;
    const handler = () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        void onSave(editor.getJSON(), editor.getText());
      }, 1200);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [editor, onSave]);

  if (!editor) {
    return <div className={cn("min-h-[200px] animate-pulse rounded-lg bg-secondary/40", className)} />;
  }

  return (
    <div className={className}>
      {editable && (
        <div className="mb-2 flex items-center gap-1 border-b border-border pb-2">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={cn("rounded px-2 py-1 text-xs font-bold", editor.isActive("bold") && "bg-secondary")}
          >
            B
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={cn("rounded px-2 py-1 text-xs italic", editor.isActive("italic") && "bg-secondary")}
          >
            I
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={cn("rounded px-2 py-1 text-xs font-semibold", editor.isActive("heading", { level: 2 }) && "bg-secondary")}
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={cn("rounded px-2 py-1 text-xs", editor.isActive("bulletList") && "bg-secondary")}
          >
            Lista
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
