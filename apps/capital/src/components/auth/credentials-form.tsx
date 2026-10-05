"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocaleSwitch } from "@/components/shell/locale-switch";

export function CredentialsForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("app");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "login") await apiPost("/api/v2/auth/login", { email, password });
      else await apiPost("/api/v2/auth/signup", { name, email, password });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      router.replace("/transactions");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="absolute top-6 right-6">
        <LocaleSwitch />
      </div>
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? t("signIn") : t("signUp")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("brand")}</p>
        </div>
        {mode === "signup" ? (
          <Field label={t("name")}>
            <Input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
          </Field>
        ) : null}
        <Field label={t("email")}>
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </Field>
        <Field label={t("password")}>
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("loading") : mode === "login" ? t("signIn") : t("signUp")}
        </Button>
        <p className="text-sm text-muted-foreground">
          {mode === "login" ? (
            <Link href="/signup" className="underline underline-offset-4">{t("needAccount")}</Link>
          ) : (
            <Link href="/login" className="underline underline-offset-4">{t("haveAccount")}</Link>
          )}
        </p>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
