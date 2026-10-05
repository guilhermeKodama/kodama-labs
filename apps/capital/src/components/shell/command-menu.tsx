"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ArrowLeftRight, Landmark, PieChart, Settings, Sparkles, Wallet } from "lucide-react";
import { apiPost } from "@/lib/api";
import { todayIso } from "@/lib/money";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";

interface ChatLine {
  role: "user" | "assistant";
  text: string;
}

function parseQuick(input: string): { description: string; amount: number; date: string } | null {
  const match = input.trim().match(/^(.*?)(-?\d+(?:[.,]\d{1,2})?)\s*$/);
  if (!match || !match[1].trim()) return null;
  const amount = Number(match[2].replace(",", "."));
  if (!Number.isFinite(amount) || amount === 0) return null;
  let description = match[1].trim();
  let date = todayIso();
  if (/\bontem\b/i.test(description)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    description = description.replace(/\bontem\b/i, "").trim();
  }
  description = description.replace(/\bhoje\b/i, "").trim();
  if (!description) return null;
  return { description, amount: Math.abs(amount), date };
}

export function CommandMenu() {
  const t = useTranslations("app");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [assistant, setAssistant] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const quick = parseQuick(query);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    setAssistant(false);
    router.push(href);
  }

  function startQuick() {
    if (!quick) return;
    const payload = encodeURIComponent(JSON.stringify(quick));
    go(`/transactions?create=${payload}`);
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
          if (!dataLine || eventName !== "token") continue;
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
      const message = error instanceof Error ? error.message : "Error";
      setLines((current) => [...current, { role: "assistant", text: message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAssistant(false);
      }}
      title={t("command")}
    >
      {assistant ? (
        <div className="flex h-96 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => setAssistant(false)}>
              {t("back")}
            </Button>
            <span className="text-sm font-medium">{t("assistant")}</span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {lines.map((line, index) => (
              <p key={index} className={line.role === "user" ? "text-right" : "text-muted-foreground"}>
                {line.text || (busy ? "…" : "")}
              </p>
            ))}
          </div>
          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("ask")}
              className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none"
            />
            <Button type="submit" size="sm" disabled={busy}>
              {t("send")}
            </Button>
          </form>
        </div>
      ) : (
        <>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("commandPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("commandEmpty")}</CommandEmpty>
            {quick ? (
              <CommandGroup heading={t("quickAdd")}>
                <CommandItem onSelect={startQuick}>
                  {quick.description} · {quick.amount}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading={t("goTo")}>
              <CommandItem onSelect={() => go("/transactions")}>
                <ArrowLeftRight /> {t("transactions")}
              </CommandItem>
              <CommandItem onSelect={() => go("/transactions/budgets")}>
                <Wallet /> {t("budgets")}
              </CommandItem>
              <CommandItem onSelect={() => go("/investments")}>
                <PieChart /> {t("portfolio")}
              </CommandItem>
              <CommandItem onSelect={() => go("/investments/contributions")}>
                <Landmark /> {t("contributions")}
              </CommandItem>
              <CommandItem onSelect={() => go("/settings")}>
                <Settings /> {t("settings")}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("assistant")}>
              <CommandItem
                onSelect={() => {
                  setAssistant(true);
                  setQuery("");
                }}
              >
                <Sparkles /> {t("openAssistant")}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </>
      )}
    </CommandDialog>
  );
}

export function openCommandMenu() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
}
