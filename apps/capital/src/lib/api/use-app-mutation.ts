"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient, type MutationFunctionContext, type UseMutationOptions } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ApiError } from "./client";
import { errorMessage } from "./errors";
import { invalidateEvent, type MutationEvent } from "./invalidation";
import { announceWrite } from "./undo";
import { readBatchId } from "./undo-stack";

/** Localized text for an error from the API (see errors.ts). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((error: unknown) => errorMessage(t, error), [t]);
}

export interface AppMutationOptions<TData, TVariables, TOnMutateResult>
  extends Omit<UseMutationOptions<TData, unknown, TVariables, TOnMutateResult>, "mutationFn" | "onError"> {
  /** What the write changes; its queries are invalidated on success (invalidation.ts). null for none. */
  event: MutationEvent | readonly MutationEvent[] | null;
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Toast for the write ("“iFood” excluída"). When the response has a
   * `batchId`, the toast gets "Desfazer" and the batch goes on the ⌘Z
   * stack; without one (nothing was recorded) it is a plain toast.
   * Without a message (or when it returns null) a batch still goes on the
   * stack, silently.
   */
  undo?: string | ((data: TData, variables: TVariables) => string | null | undefined);
  /** Return true when the error was handled here (e.g. shown inline), to skip the toast. */
  onError?: (error: unknown, variables: TVariables, onMutateResult: TOnMutateResult | undefined, context: MutationFunctionContext) => boolean | void;
}

/**
 * useMutation for every write in the app: invalidates by event, offers
 * undo when the server recorded a batch, and toasts failures in the
 * user's language. A 401 is left to the session gate.
 */
export function useAppMutation<TData = unknown, TVariables = void, TOnMutateResult = unknown>({
  event,
  undo,
  onSuccess,
  onError,
  ...options
}: AppMutationOptions<TData, TVariables, TOnMutateResult>) {
  const queryClient = useQueryClient();
  const errorText = useErrorMessage();
  return useMutation<TData, unknown, TVariables, TOnMutateResult>({
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (event) void invalidateEvent(queryClient, event);
      announceWrite(readBatchId(data), typeof undo === "function" ? undo(data, variables) : undo);
      return onSuccess?.(data, variables, onMutateResult, context);
    },
    onError: (error, variables, onMutateResult, context) => {
      if (onError?.(error, variables, onMutateResult, context) === true) return;
      if (error instanceof ApiError && error.status === 401) return;
      toast(errorText(error));
    },
  });
}
