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
      <RadioGroup
        legend="De qual cidade você sai?"
        helper="Apenas voos diretos para Orlando — GRU, CNF e VCP."
        name="origin"
        required
        options={[
          { value: "GRU", label: "São Paulo (GRU)" },
          { value: "CNF", label: "Belo Horizonte (CNF)" },
          { value: "VCP", label: "Campinas (VCP)" },
        ]}
      />

      <RadioGroup
        legend="Quando você quer viajar?"
        name="travel_window"
        required
        options={[
          { value: "0-6m", label: "Nos próximos 6 meses" },
          { value: "6-12m", label: "Em 6 a 12 meses" },
          { value: "12-18m", label: "Em 12 a 18 meses" },
          { value: "researching", label: "Ainda pesquisando" },
        ]}
      />

      <RadioGroup
        legend="Quantas pessoas na família?"
        helper="Foco em grupos de 3 a 6."
        name="group_size"
        required
        options={[
          { value: "3", label: "3" },
          { value: "4", label: "4" },
          { value: "5", label: "5" },
          { value: "6+", label: "6 ou mais" },
        ]}
      />

      <CheckboxGroup
        legend="Em quais programas você tem milhas suficientes?"
        helper="Marque todos onde tem saldo relevante. A gente cruza disponibilidade nos três."
        name="programs"
        options={[
          { value: "azul", label: "Azul Fidelidade" },
          { value: "latam", label: "LATAM Pass" },
          { value: "smiles", label: "Smiles (Gol)" },
        ]}
      />

      <fieldset className="flex flex-col gap-4 border-t border-border pt-6">
        <legend className="text-sm font-semibold">Como te avisamos?</legend>
        <TextField
          label="E-mail"
          name="email"
          type="email"
          required
          placeholder="voce@email.com"
        />
        <TextField
          label="Telegram ou WhatsApp"
          name="contact"
          type="text"
          required
          placeholder="@seu_usuario ou +55 11 9XXXX-XXXX"
          helper="Os alertas chegam aqui em segundos — Telegram é mais rápido."
        />
      </fieldset>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Enviando…" : "Quero receber os alertas"}
      </button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <p className="text-xs text-muted-foreground">
        Não compartilhamos seus dados. Você pode sair a qualquer momento.
      </p>
    </form>
  );
}

function TextField({
  label,
  name,
  type,
  required,
  placeholder,
  helper,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  helper?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
      />
      {helper ? (
        <span className="text-xs text-muted-foreground">{helper}</span>
      ) : null}
    </label>
  );
}

function RadioGroup({
  legend,
  helper,
  name,
  options,
  required,
}: {
  legend: string;
  helper?: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{legend}</legend>
      {helper ? (
        <p className="-mt-2 text-xs text-muted-foreground">{helper}</p>
      ) : null}
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
  helper,
  name,
  options,
}: {
  legend: string;
  helper?: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{legend}</legend>
      {helper ? (
        <p className="-mt-2 text-xs text-muted-foreground">{helper}</p>
      ) : null}
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
