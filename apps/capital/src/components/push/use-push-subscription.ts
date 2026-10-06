'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiPost } from '@/lib/api/client';
import { encodeDeviceLabel } from '@/lib/settings/device';
import { env } from '@/env';

export type PushSubscriptionStatus =
  | 'unsupported'
  | 'ios-needs-install'
  | 'denied'
  | 'not-subscribed'
  | 'subscribing'
  | 'subscribed'
  | 'error';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

async function postSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
  await apiPost('/api/v1/push/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    // "<device>|<browser>[|pwa]"; Ajustes › Notificações turns it into "Mac · Chrome".
    deviceLabel: encodeDeviceLabel(navigator.userAgent, isStandalone()),
    userAgent: navigator.userAgent.slice(0, 500),
  });
}

/**
 * Drives the "enable push notifications" flow (Ajustes › Notificações).
 * Safe to mount in several places at once — each instance independently
 * reads the same browser-level permission/subscription state. `endpoint` is
 * this browser's subscription, which marks the current row in the device
 * list.
 */
export function usePushSubscription() {
  const [status, setStatus] = useState<PushSubscriptionStatus>('not-subscribed');
  const [error, setError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);

  // On mount: detect current state, and if permission is already granted and
  // the browser still holds a subscription, silently re-POST it. This is the
  // reliable way to keep the server's copy alive — the service worker can't
  // fetch() past Cloudflare Access (see app/sw.js/route.ts), so a subscription
  // rotation there would otherwise go unnoticed.
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setStatus(isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('denied');
        return;
      }

      if (Notification.permission !== 'granted') {
        if (!cancelled) setStatus('not-subscribed');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!existing) {
          if (!cancelled) setStatus('not-subscribed');
          return;
        }
        await postSubscription(existing);
        if (!cancelled) {
          setEndpoint(existing.endpoint);
          setStatus('subscribed');
        }
      } catch {
        if (!cancelled) setStatus('not-subscribed');
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setStatus('subscribing');
    setError(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus(isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported');
        return false;
      }

      const vapidPublicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setError('Push not configured on the server');
        setStatus('error');
        return false;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      await postSubscription(subscription);
      setEndpoint(subscription.endpoint);
      setStatus('subscribed');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setStatus('error');
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator)) return;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const current = subscription.endpoint;
        await subscription.unsubscribe();
        await api('/api/v1/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: current }) });
      }
      setEndpoint(null);
      setStatus('not-subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setStatus('error');
    }
  }, []);

  return { status, error, endpoint, enable, disable };
}
