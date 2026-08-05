"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

// Canonical lead fields the importer understands; everything else on a row
// becomes form_data (group_size, travel_window, alerts_sent, issuances, ...).
const CANONICAL = new Set([
  "email",
  "name",
  "contact",
  "status",
  "created_at",
  "activated_at",
  "converted_at",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
  "customer_value",
  "notes",
]);

// Friendly header variants (PT/EN) → canonical.
const HEADER_ALIASES: Record<string, string> = {
  "e-mail": "email",
  e_mail: "email",
  nome: "name",
  nome_usado: "name",
  contato: "contact",
  telefone: "contact",
  whatsapp: "contact",
  telegram: "contact",
  data: "created_at",
  criado_em: "created_at",
  recebido_em: "created_at",
  received_at: "created_at",
  ativado_em: "activated_at",
  convertido_em: "converted_at",
  emitido_em: "converted_at",
  observacoes: "notes",
  observações: "notes",
  notas: "notes",
  obs: "notes",
  fonte: "utm_source", // só "fonte" — "origem" é ambíguo (origem da viagem ≠ tráfego)
  campanha: "utm_campaign",
  valor: "customer_value",
  receita: "customer_value",
  ltv: "customer_value",
};

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

// Minimal CSV parser with quoted-field support.
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0]!.map(normalizeHeader);
  return rows.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])),
  );
}

interface ImportRow {
  email: string;
  form_data: Record<string, string>;
  [k: string]: unknown;
}

function toPayloadRow(obj: Record<string, string>): ImportRow {
  const out: ImportRow = { email: "", form_data: {} };
  for (const [key, value] of Object.entries(obj)) {
    if (value === "") continue;
    if (CANONICAL.has(key)) out[key] = value;
    else out.form_data[key] = value;
  }
  return out;
}

const TEMPLATE =
  "email,name,contact,status,created_at,activated_at,converted_at,customer_value,utm_source,utm_campaign,notes,group_size,issuances\n" +
  "camila@example.com,Camila,@camila,active,2026-06-05,2026-06-07,,,meta,MG_Disney_Lead_Beta_v1,quer 4 assentos GRU-MCO,4,0\n" +
  "rafael@example.com,Rafael,(11) 99999-9999,customer,2026-06-06,2026-06-08,2026-06-12,1500,meta,MG_Disney_Lead_Beta_v1,emitiu 5 bilhetes,5,5\n" +
  "joana@example.com,Joana,@joana,new,2026-06-10,,,,meta,MG_Disney_Lead_Beta_v1,,3,0\n";

export function CsvImportCard({
  ideas,
}: {
  ideas: Array<{ slug: string; name: string }>;
}) {
  const t = useTranslations("ops.import");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [slug, setSlug] = useState(ideas[0]?.slug ?? "");
  const [defaultSource, setDefaultSource] = useState("meta");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onFile(file: File) {
    let leads: ImportRow[];
    try {
      const text = await file.text();
      leads = parseCsv(text).map(toPayloadRow).filter((r) => r.email);
    } catch {
      toast.error(t("parseError"));
      return;
    }
    if (!leads.length) {
      toast.error(t("noRows"));
      return;
    }

    setBusy(true);
    const res = await fetch("/api/v1/leads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        defaultUtmSource: defaultSource || undefined,
        leads,
      }),
    });
    setBusy(false);

    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      created?: number;
      updated?: number;
      skipped?: number;
      errors?: string[];
      error?: string;
    } | null;

    if (!res.ok || !body?.ok) {
      toast.error(body?.error ?? t("failed"));
      return;
    }
    toast.success(
      t("done", {
        created: body.created ?? 0,
        updated: body.updated ?? 0,
        skipped: body.skipped ?? 0,
      }),
    );
    if (body.errors?.length) {
      toast.warning(
        `${body.errors.length} ${t("rowErrors")}: ${body.errors[0]}`,
      );
    }
    if (fileRef.current) fileRef.current.value = "";
    startTransition(() => router.refresh());
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">{t("idea")}</span>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="block w-44 rounded-md border bg-card px-2 py-1.5 text-xs"
          >
            {ideas.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">{t("channel")}</span>
          <select
            value={defaultSource}
            onChange={(e) => setDefaultSource(e.target.value)}
            className="block w-40 rounded-md border bg-card px-2 py-1.5 text-xs"
          >
            <option value="meta">Meta</option>
            <option value="google">Google</option>
            <option value="">{t("channelAuto")}</option>
          </select>
        </label>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !slug}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          {busy ? t("importing") : t("choose")}
        </Button>

        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          {t("template")}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {t("hint")}
      </p>
    </div>
  );
}
