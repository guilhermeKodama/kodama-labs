"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Btn, Field, TextInput } from "@/components/cap";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, apiPost } from "@/lib/api/client";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import {
  authRedirectTarget,
  authSwitchHref,
  credentialsBody,
  invalidCredentialFields,
  MIN_PASSWORD_LENGTH,
  validateCredentials,
  type AuthMode,
  type CredentialsField,
  type CredentialsInput,
  type CredentialsProblems,
} from "@/lib/shell/auth";

const noSubscribe = () => () => {};

/**
 * Login and signup, in the mockup's visual language (a dialog-like card on
 * the chrome background, Field labels, 26px inputs and buttons). After
 * signing in the app returns to `?redirect` when it is a path of this app;
 * the link to the other page keeps it. Errors come from the server's code
 * (errors.<code>), never its English message.
 */
export function CredentialsForm({ mode }: { mode: AuthMode }) {
  const t = useTranslations("auth");
  const errorText = useErrorMessage();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Read after hydration: the page is prerendered without a query.
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const [values, setValues] = useState<CredentialsInput>({ name: "", email: "", password: "" });
  const [problems, setProblems] = useState<CredentialsProblems>({});
  const [serverFields, setServerFields] = useState<Set<CredentialsField>>(new Set());
  const [leaving, setLeaving] = useState(false);

  const submit = useAppMutation({
    event: null,
    mutationFn: (input: CredentialsInput) => apiPost(`/api/v2/auth/${mode}`, credentialsBody(mode, input, locale)),
    onSuccess: () => {
      // A new session: nothing cached from before may show.
      queryClient.clear();
      setLeaving(true);
      router.replace(authRedirectTarget(window.location.search));
    },
    // Shown in the form (below), not as a toast.
    onError: (error) => {
      setServerFields(error instanceof ApiError ? invalidCredentialFields(error) : new Set());
      return true;
    },
  });
  const pending = submit.isPending || leaving;

  const change = (field: CredentialsField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setProblems((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setServerFields((current) => (current.has(field) ? new Set([...current].filter((item) => item !== field)) : current));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const found = validateCredentials(mode, values);
    setProblems(found);
    const first = (["name", "email", "password"] as const).find((field) => found[field]);
    if (first) {
      document.getElementById(`auth-${first}`)?.focus();
      return;
    }
    submit.reset();
    setServerFields(new Set());
    submit.mutate(values);
  };

  const problemText = (field: CredentialsField) => {
    const problem = problems[field];
    if (!problem) return null;
    return (
      <span id={`auth-${field}-problem`} className="text-neg">
        {t(`problems.${problem}`, { min: MIN_PASSWORD_LENGTH })}
      </span>
    );
  };
  const inputProps = (field: CredentialsField) => {
    const invalid = Boolean(problems[field]) || serverFields.has(field);
    return {
      id: `auth-${field}`,
      value: values[field],
      onChange: change(field),
      invalid,
      disabled: pending,
      "aria-describedby": problems[field] ? `auth-${field}-problem` : undefined,
      className: "w-full",
    };
  };

  return (
    <main className="flex min-h-dvh items-start justify-center bg-chrome px-4 pt-[12vh] pb-10 text-fg-1">
      <form noValidate onSubmit={onSubmit} aria-busy={pending} className="flex w-full max-w-[360px] flex-col gap-3.5 rounded-[12px] border border-stroke-1 bg-editor p-[18px]">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-fg-1 text-[12px] font-bold text-editor">
            C
          </span>
          <span className="text-[12.5px] font-semibold">Capital</span>
        </div>
        <div className="flex flex-col gap-[3px]">
          <h1 className="text-[15px] font-semibold">{t(`${mode}.title`)}</h1>
          <p className="text-[12px] text-fg-3">{t(`${mode}.description`)}</p>
        </div>
        {mode === "signup" ? (
          <Field label={t("fields.name")} htmlFor="auth-name" hint={problemText("name")}>
            <TextInput {...inputProps("name")} autoComplete="name" autoFocus />
          </Field>
        ) : null}
        <Field label={t("fields.email")} htmlFor="auth-email" hint={problemText("email")}>
          <TextInput {...inputProps("email")} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} autoFocus={mode === "login"} />
        </Field>
        <Field
          label={t("fields.password")}
          htmlFor="auth-password"
          hint={problemText("password") ?? (mode === "signup" ? t("fields.passwordHint", { min: MIN_PASSWORD_LENGTH }) : null)}
        >
          <TextInput {...inputProps("password")} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        {submit.isError ? (
          <p role="alert" className="text-[12px] text-neg">
            {errorText(submit.error)}
          </p>
        ) : null}
        <Btn primary type="submit" disabled={pending} className="w-full">
          {pending ? t(`${mode}.pending`) : t(`${mode}.submit`)}
        </Btn>
        <p className="text-[12px] text-fg-3">
          {t(`${mode}.switchPrompt`)}{" "}
          <Link href={authSwitchHref(mode === "login" ? "signup" : "login", search)} className="font-medium text-fg-1 underline-offset-2 hover:underline">
            {t(`${mode}.switch`)}
          </Link>
        </p>
      </form>
    </main>
  );
}
