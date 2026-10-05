"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@/i18n/navigation";
import { apiPost } from "@/lib/api";
import { Btn } from "@/components/shell/chrome";

export function CredentialsForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white text-neutral-950">
      <form
        className="w-full max-w-sm space-y-3 px-4"
        onSubmit={(event) => {
          event.preventDefault();
          const request = mode === "login"
            ? apiPost("/api/v2/auth/login", { email, password })
            : apiPost("/api/v2/auth/signup", { name, email, password });
          void request.then(async () => {
            await queryClient.invalidateQueries({ queryKey: ["me"] });
            router.replace("/transactions");
          }).catch((err: Error) => setError(err.message));
        }}
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-[6px] bg-neutral-950 text-[12px] font-bold text-white">C</span>
          <span className="text-[14px] font-semibold">{mode === "login" ? "Entrar" : "Criar conta"}</span>
        </div>
        {mode === "signup" ? <Field label="Nome" value={name} onChange={setName} /> : null}
        <Field label="E-mail" value={email} onChange={setEmail} type="email" />
        <Field label="Senha" value={password} onChange={setPassword} type="password" />
        {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        <Btn primary type="submit">{mode === "login" ? "Entrar" : "Criar conta"}</Btn>
        <p className="text-[12px] text-neutral-500">
          {mode === "login" ? <Link href="/signup">Criar uma conta</Link> : <Link href="/login">Já tenho conta</Link>}
        </p>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-neutral-400">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required className="h-[26px] w-full rounded-[6px] border border-neutral-300 px-2 text-[12.5px] outline-none" />
    </label>
  );
}
