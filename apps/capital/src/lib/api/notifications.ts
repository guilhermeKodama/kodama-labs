"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPrefs } from "@capital/server/modules/notifications/services/settings";
import { apiDelete, apiGet, apiPatch } from "./client";
import { keys } from "./keys";
import { useAppMutation } from "./use-app-mutation";

/** GET /v2/notifications/settings: the toggles plus whether the server can send push at all. */
export type NotificationSettingsRecord = NotificationPrefs & { pushConfigured: boolean };

export interface PushDeviceRecord {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** This browser's subscription. */
  isCurrent: boolean;
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: keys.notificationsSettings(),
    queryFn: () => apiGet<NotificationSettingsRecord>("/api/v2/notifications/settings"),
  });
}

/** Saves toggles; the switch moves at once and goes back if the save fails. */
export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  const key = keys.notificationsSettings();
  return useAppMutation({
    event: "notifications.write",
    mutationFn: (patch: Partial<NotificationPrefs>) => apiPatch<NotificationSettingsRecord>("/api/v2/notifications/settings", patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSettingsRecord>(key);
      if (previous) queryClient.setQueryData(key, { ...previous, ...patch });
      return previous;
    },
    onError: (_error, _patch, previous) => {
      if (previous) queryClient.setQueryData(key, previous);
    },
  });
}

/** Devices receiving pushes; `endpoint` (this browser's subscription) marks the current one. */
export function usePushDevices(endpoint: string | null) {
  return useQuery({
    queryKey: keys.devices(endpoint),
    queryFn: () => apiGet<{ pushConfigured: boolean; devices: PushDeviceRecord[] }>("/api/v2/notifications/devices", endpoint ? { endpoint } : {}),
  });
}

/** Stops pushes to a device; `message` is the confirmation toast. */
export function useRemovePushDevice() {
  return useAppMutation({
    event: "notifications.write",
    mutationFn: ({ id }: { id: string; message: string }) => apiDelete<{ ok: true; id: string }>(`/api/v2/notifications/devices/${id}`),
    undo: (_data, { message }) => message,
  });
}
