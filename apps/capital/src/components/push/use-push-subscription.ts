'use client';

import { useCallback, useEffect, useState } from 'react';
import { client } from '@/lib/api-client';
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

function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  return 'Dispositivo';
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
  await client.v1.push.subscribe.$post({
    json: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      deviceLabel: guessDeviceLabel(),
      userAgent: navigator.userAgent,
    },
  });
}

/**
 * Drives the "enable push notifications" flow for reminder-mode recurring
 * transactions. Safe to mount in multiple places at once (the settings card
 * and the recurring form's inline nudge both use it) — each instance
 * independently reads the same browser-level permission/subscription state.
 */
export function usePushSubscription() {
  const [status, setStatus] = useState<PushSubscriptionStatus>('not-subscribed');
  const [error, setError] = useState<string | null>(null);

  // On mount: detect current state, and if permission is already granted and
  // the browser still holds a subscription, silently re-POST it. This is the
  // reliable way to keep the server's copy alive — the service worker can't
  // fetch() past Cloudflare Access (see public/sw.js), so a subscription
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
        if (!cancelled) setStatus('subscribed');
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
        return;
      }

      const vapidPublicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setError('Push not configured on the server');
        setStatus('error');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      await postSubscription(subscription);
      setStatus('subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setStatus('error');
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator)) return;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await client.v1.push.subscribe.$delete({ json: { endpoint } });
      }
      setStatus('not-subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setStatus('error');
    }
  }, []);

  return { status, error, enable, disable };
}
