"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export function IntakeForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const payload: Record<string, string | string[]> = {};
    for (const key of new Set(formData.keys())) {
      const values = formData.getAll(key).map(String);
      payload[key] = values.length > 1 ? values : (values[0] ?? "");
    }

    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.push("/thanks");
    } catch (err) {
      console.error(err);
      setError("Não foi possível enviar agora. Tente novamente em instantes.");
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-8" onSubmit={onSubmit}>
      {/* Example: single-select radio group. Replace with your idea's field. */}
      <RadioGroup
        legend="Pergunta de exemplo (escolha uma)"
        name="example_single"
        required
        options={[
          { value: "a", label: "Opção A" },
          { value: "b", label: "Opção B" },
          { value: "c", label: "Opção C" },
        ]}
      />

      {/* Example: multi-select checkbox group. Replace with your idea's field. */}
      <CheckboxGroup
        legend="Pergunta múltipla (escolha quantas quiser)"
        name="example_multi"
        options={[
          { value: "x", label: "Opção X" },
          { value: "y", label: "Opção Y" },
          { value: "z", label: "Opção Z" },
        ]}
      />

      <fieldset className="flex flex-col gap-4 border-t border-border pt-6">
        <legend className="text-sm font-semibold">Contato</legend>
        <TextField label="E-mail" name="email" type="email" required />
        <TextField
          label="WhatsApp ou Telegram"
          name="contact"
          type="text"
          required
        />
      </fieldset>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Enviando…" : "Enviar"}
      </button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

function TextField({
  label,
  name,
  type,
  required,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function RadioGroup({
  legend,
  name,
  options,
  required,
}: {
  legend: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              required={required}
              className="accent-primary"
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CheckboxGroup({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="checkbox"
              name={name}
              value={opt.value}
              className="accent-primary"
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
