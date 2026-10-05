"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { apiPost } from "@/lib/api/client";
import { todayIso } from "@/lib/money";

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [assistant, setAssistant] = useState(false);
  const [lines, setLines] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const openMenu = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("capital:command", openMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("capital:command", openMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const match = query.trim().match(/^(.*?)(-?\d+(?:[.,]\d{1,2})?)\s*$/);
  const quick = match && match[1].trim() ? { description: match[1].replace(/\b(hoje|ontem)\b/gi, "").trim(), amount: Number(match[2].replace(",", ".")), date: todayIso() } : null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setLines((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      const id = conversationId ?? (await apiPost<{ id: string }>("/api/v1/assistant/conversations", { title: text.slice(0, 80) })).id;
      if (!conversationId) setConversationId(id);
      const res = await fetch(`/api/v1/assistant/conversations/${id}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const eventName = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (eventName !== "token" || !dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim()) as { delta?: string };
          if (!payload.delta) continue;
          setLines((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + payload.delta };
            return next;
          });
        }
      }
    } catch (error) {
      setLines((current) => [...current, { role: "assistant", text: error instanceof Error ? error.message : "Erro" }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/30 pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="w-[560px] overflow-hidden rounded-[10px] border border-stroke-3 bg-editor shadow-lg" onClick={(event) => event.stopPropagation()}>
        {assistant ? (
          <div className="flex h-80 flex-col">
            <div className="flex h-9 items-center gap-2 border-b border-stroke-3 px-3 text-[12.5px]">
              <button type="button" onClick={() => setAssistant(false)}>Voltar</button>
              <span className="font-medium">Assistente</span>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-3 text-[12.5px]">
              {lines.map((line, index) => (
                <p key={index} className={line.role === "user" ? "text-right" : "text-fg-muted"}>{line.text || "…"}</p>
              ))}
            </div>
            <form className="flex gap-2 border-t border-stroke-3 p-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} className="h-7 flex-1 rounded-[6px] border border-stroke-3 px-2 text-[12px] outline-none" placeholder="Pergunte alguma coisa" />
              <button type="submit" className="h-[26px] rounded-[6px] bg-fg-1 px-2.5 text-[12px] text-editor">Enviar</button>
            </form>
          </div>
        ) : (
          <>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ou executar…" className="h-11 w-full border-b border-stroke-3 px-3 text-[13px] outline-none" />
            <div className="p-1 text-[12.5px]">
              {quick?.description ? (
                <button type="button" className="flex h-7 w-full items-center rounded-[6px] px-2 hover:bg-fill-3" onClick={() => go(`/transactions?create=${encodeURIComponent(JSON.stringify(quick))}`)}>
                  Criar “{quick.description}” · {quick.amount}
                </button>
              ) : null}
              {[
                ["/transactions", "Lançamentos"],
                ["/transactions/budgets", "Orçamentos"],
                ["/investments", "Carteira"],
                ["/investments/contributions", "Aportes"],
                ["/settings", "Ajustes"],
              ].map(([href, label]) => (
                <button key={href} type="button" className="flex h-7 w-full items-center rounded-[6px] px-2 hover:bg-fill-3" onClick={() => go(href)}>{label}</button>
              ))}
              <button type="button" className="flex h-7 w-full items-center rounded-[6px] px-2 hover:bg-fill-3" onClick={() => setAssistant(true)}>Assistente</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
