"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Btn, Table, Toggle } from "@/components/cap";
import { usePushSubscription } from "@/components/push/use-push-subscription";
import { invalidateEvent } from "@/lib/api/invalidation";
import { usePushDevices, useRemovePushDevice, useNotificationSettings, useUpdateNotificationSettings, type NotificationSettingsRecord, type PushDeviceRecord } from "@/lib/api/notifications";
import { useFmt } from "@/lib/format/provider";
import { parseDeviceLabel } from "@/lib/settings/device";
import { hourLabel } from "@/lib/settings/time";

type ToggleField = "dueEnabled" | "overdueEnabled" | "billClosedEnabled" | "budgetEnabled" | "weeklyEnabled";

/** Notificações: which pushes the user gets, and the devices that get them. */
export function NotificationsPage() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const push = usePushSubscription();
  const devices = usePushDevices(push.endpoint);
  const remove = useRemovePushDevice();

  const s = settings.data;
  const label = (field: ToggleField, prefs: NotificationSettingsRecord): string => {
    switch (field) {
      case "dueEnabled":
        return t("due", { days: prefs.dueDaysBefore, time: hourLabel(prefs.dueHour, locale) });
      case "overdueEnabled":
        return t("overdue");
      case "billClosedEnabled":
        return t("bill");
      case "budgetEnabled":
        return t("budget", { threshold: fmt.pct(prefs.budgetThreshold, 0) });
      case "weeklyEnabled":
        return t("weekly", { day: t(`weekday.${String(prefs.weeklyDow) as "1"}`), time: hourLabel(prefs.weeklyHour, locale) });
    }
  };

  const deviceName = (device: PushDeviceRecord) => {
    const info = parseDeviceLabel(device.deviceLabel, device.userAgent);
    const name = t(`device.${info.device}`);
    return info.pwa ? t("devices.labelPwa", { device: name }) : t("devices.label", { device: name, browser: t(`browser.${info.browser}`) });
  };

  const refreshDevices = () => invalidateEvent(queryClient, "notifications.write");
  const enable = async () => {
    await push.enable();
    await refreshDevices();
  };
  const removeDevice = (device: PushDeviceRecord) => {
    const message = t("toastRemoved", { device: deviceName(device) });
    // This browser: unsubscribe it too, or it would subscribe again on the next visit.
    if (device.isCurrent) {
      void push.disable().then(async () => {
        await refreshDevices();
        toast(message);
      });
      return;
    }
    remove.mutate({ id: device.id, message });
  };

  const pushConfigured = devices.data?.pushConfigured ?? s?.pushConfigured ?? true;
  const pushNote = !pushConfigured
    ? t("push.notConfigured")
    : push.status === "unsupported"
      ? t("push.unsupported")
      : push.status === "ios-needs-install"
        ? t("push.iosInstall")
        : push.status === "denied"
          ? t("push.denied")
          : push.status === "error"
            ? t("push.error", { message: push.error ?? "" })
            : push.status === "not-subscribed" || push.status === "subscribing"
              ? t("push.off")
              : null;
  const canEnable = pushConfigured && (push.status === "not-subscribed" || push.status === "subscribing" || push.status === "error");

  const rows = devices.data?.devices ?? [];
  return (
    <div className="flex max-w-[640px] flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        {(["dueEnabled", "overdueEnabled", "billClosedEnabled", "budgetEnabled", "weeklyEnabled"] as const).map((field) => (
          <div key={field} className="flex items-center gap-2">
            <label htmlFor={`notif-${field}`} className="text-[12.5px]">
              {s ? label(field, s) : "…"}
            </label>
            <span className="flex-1" />
            <Toggle id={`notif-${field}`} checked={s?.[field] ?? false} disabled={!s} onChange={(value) => update.mutate({ [field]: value })} />
          </div>
        ))}
      </div>
      {pushNote ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-fg-3">{pushNote}</span>
          <span className="flex-1" />
          {canEnable ? (
            <Btn onClick={() => void enable()} disabled={push.status === "subscribing"}>
              {push.status === "subscribing" ? t("push.enabling") : t("push.enable")}
            </Btn>
          ) : null}
        </div>
      ) : null}
      <Table
        headers={[t("devices.device"), t("devices.lastUsed"), ""]}
        columnAlign={["left", "left", "right"]}
        rowKey={(i) => rows[i].id}
        emptyMessage={devices.isSuccess ? t("devices.empty") : undefined}
        rows={rows.map((device) => [
          deviceName(device),
          <span key="seen" className="text-fg-2">{fmt.relative(device.lastSeenAt)}</span>,
          <button
            key="remove"
            type="button"
            disabled={remove.isPending}
            onClick={() => removeDevice(device)}
            className="text-fg-3 outline-none hover:text-fg-1 focus-visible:underline"
          >
            {t("devices.remove")}
          </button>,
        ])}
      />
    </div>
  );
}
