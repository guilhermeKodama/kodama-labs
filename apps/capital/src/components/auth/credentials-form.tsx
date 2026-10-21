"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Btn, Field, TextInput, Wordmark } from "@/components/cap";
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
 * (errors.<code>), never its English message. While sign-up is closed
 * (SIGNUP_OPEN), the login card does not offer it.
 */
export function CredentialsForm({ mode, signupOpen = true }: { mode: AuthMode; signupOpen?: boolean }) {
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

  // Centered on a phone (clear of the status bar and home indicator); 12% from the top on a desktop, as in the mockup.
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chrome px-4 pt-[calc(2.5rem+var(--safe-top))] pb-[calc(2.5rem+var(--safe-bottom))] text-fg-1 standalone:min-h-screen sm:items-start sm:pt-[12vh]">
      <form noValidate onSubmit={onSubmit} aria-busy={pending} className="flex w-full max-w-[360px] flex-col gap-3.5 rounded-[12px] border border-stroke-1 bg-panel p-[18px]">
        <Wordmark className="self-start" markClassName="size-7" />
        <div className="flex flex-col gap-[3px]">
          <h1 className="font-title text-title font-medium">{t(`${mode}.title`)}</h1>
          <p className="text-body-sm text-fg-3">{t(`${mode}.description`)}</p>
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
          <p role="alert" className="text-body-sm text-neg">
            {errorText(submit.error)}
          </p>
        ) : null}
        <Btn primary type="submit" disabled={pending} className="w-full">
          {pending ? t(`${mode}.pending`) : t(`${mode}.submit`)}
        </Btn>
        {mode === "signup" || signupOpen ? (
          <p className="text-body-sm text-fg-3">
            {t(`${mode}.switchPrompt`)}{" "}
            <Link href={authSwitchHref(mode === "login" ? "signup" : "login", search)} className="font-medium text-fg-1 underline-offset-2 hover:underline">
              {t(`${mode}.switch`)}
            </Link>
          </p>
        ) : null}
      </form>
    </main>
  );
}
