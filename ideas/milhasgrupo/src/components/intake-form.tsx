"use client";

import { useId, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { trackCompleteRegistration, trackLead } from "@/lib/analytics";
import { readUtmsFromUrl } from "@/lib/utm";

type Step1Data = Record<string, string | string[]>;

export function IntakeForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [step1Data, setStep1Data] = useState<Step1Data>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onStep1Submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStep1Data(serializeFormData(new FormData(event.currentTarget)));
    trackLead();
    setStep(2);
  }

  async function onStep2Submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const step2Data = serializeFormData(new FormData(event.currentTarget));
    const payload: Record<string, string | string[]> = {
      ...step1Data,
      ...step2Data,
      ...readUtmsFromUrl(),
    };

    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      trackCompleteRegistration();
      router.push("/thanks");
    } catch (err) {
      console.error(err);
      setError("Não foi possível enviar agora. Tente novamente em instantes.");
      setSubmitting(false);
    }
  }

  if (step === 1) {
    return (
      <form className="flex flex-col gap-8" onSubmit={onStep1Submit}>
        <FieldRadio
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

        <Separator />

        <FieldRadio
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

        <Separator />

        <FieldText
          label="E-mail"
          name="email"
          type="email"
          required
          placeholder="voce@email.com"
        />

        <Button type="submit" size="lg" className="w-full">
          Continuar
        </Button>

        <p className="text-xs text-muted-foreground">
          Etapa 1 de 2. Em seguida pedimos só o seu contato.
        </p>
      </form>
    );
  }

  return (
    <form className="flex flex-col gap-8" onSubmit={onStep2Submit}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">Como te avisamos?</h3>
          <p className="text-sm text-muted-foreground">
            Os alertas chegam em segundos. Telegram é mais rápido.
          </p>
        </div>
        <FieldText
          label="Telegram ou WhatsApp"
          name="contact"
          type="text"
          required
          placeholder="@seu_usuario ou +55 11 9XXXX-XXXX"
        />
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? "Enviando…" : "Quero receber os alertas"}
      </Button>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Não compartilhamos seus dados. Você pode sair a qualquer momento.
        </p>
      )}
    </form>
  );
}

function serializeFormData(formData: FormData): Record<string, string | string[]> {
  const payload: Record<string, string | string[]> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).map(String);
    payload[key] = values.length > 1 ? values : (values[0] ?? "");
  }
  return payload;
}

function FieldText({
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
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
      />
      {helper ? (
        <p className="text-xs text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}

function FieldRadio({
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{legend}</h3>
        {helper ? (
          <p className="text-sm text-muted-foreground">{helper}</p>
        ) : null}
      </div>
      <RadioGroup
        name={name}
        required={required}
        className="grid gap-2 sm:grid-cols-3"
      >
        {options.map((opt) => {
          const id = `${name}-${opt.value}`;
          return (
            <Label
              key={opt.value}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-input bg-background px-4 py-3 text-sm font-normal transition has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem id={id} value={opt.value} />
              <span>{opt.label}</span>
            </Label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
