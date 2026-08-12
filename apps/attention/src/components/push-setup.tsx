"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function guessDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  return "Dispositivo";
}

type Status = "idle" | "unsupported" | "denied" | "subscribing" | "subscribed" | "error";

export function PushSetup({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      setError(String(err));
      setStatus("error");
    });
  }, []);

  async function subscribe() {
    setStatus("subscribing");
    setError(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = subscription.toJSON();

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          deviceLabel: guessDeviceLabel(),
          userAgent: navigator.userAgent,
        }),
      });

      setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro desconhecido");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={subscribe}
        disabled={status === "subscribing" || status === "subscribed"}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {status === "subscribed"
          ? "Inscrito"
          : status === "subscribing"
            ? "Inscrevendo…"
            : "Ativar notificações"}
      </button>
      {status === "unsupported" && (
        <p className="text-sm text-amber-400">
          Este navegador não suporta push. No iPhone, adicione à Tela de Início pelo Safari
          primeiro.
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm text-red-400">
          Permissão negada. Ative em Ajustes → Notificações.
        </p>
      )}
      {status === "error" && <p className="text-sm text-red-400">Erro: {error}</p>}
      {status === "subscribed" && (
        <p className="text-sm text-emerald-400">
          Pronto. Beacons chegam a cada 30 min, ou dispare um manualmente em /lab.
        </p>
      )}
    </div>
  );
}
