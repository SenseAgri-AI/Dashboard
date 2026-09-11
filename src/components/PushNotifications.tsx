"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { watchPushTest } from "@/lib/pushTest";

// The app's ONLY job in the push pipeline: a one-time handshake that asks the phone's permission,
// creates the push subscription ("mailbox address"), and hands it to our server. After this, delivery
// is independent of the app (server → Apple/Google → the service worker shows the notification).

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// VAPID public key (URL-safe base64) → the Uint8Array the browser wants for applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type Tone = "ok" | "err" | null;

export default function PushNotifications() {
  const { userId, orgId } = useAuth();
  const cancelTest = useRef<(() => void) | null>(null);
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: Tone }>({ text: "", tone: null });

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setSubscribed(false);
      setSupported(ok);
      if (!ok) return;
      return navigator.serviceWorker.getRegistration()
      .then(async (reg) => {
        const sub = reg && await reg.pushManager.getSubscription();
        if (!sub) return;
        const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`);
        const data = res.ok ? await res.json() : {};
        if (!cancelled) setSubscribed(data.subscribed === true);
      })
      .catch(() => {});
    });
    return () => { cancelled = true; cancelTest.current?.(); };
  }, [userId, orgId]);

  const enable = async () => {
    setBusy(true); setMsg({ text: "", tone: null });
    try {
      if (!VAPID_PUBLIC) throw new Error("Notifications are not available yet. Please try again later.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setMsg({ text: "Permission blocked — allow notifications in your browser/phone settings, then try again.", tone: "err" }); return; }
      await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save the subscription.");
      setSubscribed(true);
      setMsg({ text: "Notifications enabled on this device ✓", tone: "ok" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't enable notifications.", tone: "err" });
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg({ text: "", tone: null });
    let watcher: ReturnType<typeof watchPushTest> | undefined;
    try {
      if (Notification.permission !== "granted") throw new Error("Allow notifications on this device, then try again.");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) { setSubscribed(false); throw new Error("Enable notifications on this device first."); }
      const testId = crypto.randomUUID();
      watcher = watchPushTest(navigator.serviceWorker, testId);
      cancelTest.current = watcher.cancel;
      setMsg({ text: "Testing this device…", tone: null });
      const res = await fetch("/api/push/test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, testId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404 || res.status === 410) setSubscribed(false);
        throw new Error(data.error ?? "Test failed.");
      }
      const receipt = await watcher.result;
      if (receipt === "cancelled") return;
      if (receipt === "display-failed") {
        throw new Error("This device received the test but couldn't display it. Check notification permissions below.");
      }
      // Also supports the previous worker during a service-worker update.
      const shown = receipt === "displayed" || (await reg.getNotifications({ tag: `senseagri-test-${testId}` })).length > 0;
      setMsg(shown
        ? { text: "This device received the test. If no banner appeared, check your device's notification settings below.", tone: "ok" }
        : { text: "The push service accepted the test, but this device hasn't confirmed receipt. Reopen the app and try again, or use the display check below.", tone: null });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't test this device.", tone: "err" });
    } finally {
      watcher?.cancel(); cancelTest.current = null; setBusy(false);
    }
  };

  const checkDisplay = async () => {
    setBusy(true);
    try {
      if (Notification.permission !== "granted") throw new Error("Allow notifications on this device first.");
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg?.active) throw new Error("Reopen the app and enable notifications first.");
      await reg.showNotification("SenseAgri · display check", {
        body: "This notification was created on this device only.",
        icon: "/icon-192.png", tag: `senseagri-display-${crypto.randomUUID()}`,
        data: { url: "/dashboard" },
      });
      setMsg({ text: "The browser accepted the display check. If nothing appeared, check Notification Centre and the device settings below.", tone: null });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't display a notification.", tone: "err" });
    } finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: "rgba(255,255,255,0.72)", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
  const btn = (primary: boolean): React.CSSProperties => ({
    minHeight: 34, padding: "6px 14px", borderRadius: 8, cursor: busy ? "default" : "pointer",
    fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-s)",
    border: primary ? "1px solid #002E35" : "1px solid var(--divider, rgba(0,0,0,0.12))",
    background: primary ? "#002E35" : "#fff", color: primary ? "#fff" : "var(--t2)", opacity: busy ? 0.6 : 1,
  });

  if (!supported) {
    return <div style={card}><span style={{ fontSize: 12, color: "var(--t3)" }}>This browser doesn&apos;t support push notifications. On iPhone, install the app to your Home Screen first (Share → Add to Home Screen).</span></div>;
  }

  return (
    <div style={card}>
      <div style={{ minWidth: 0, marginRight: "auto" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--primary, #002E35)" }}>Notifications </div>
        <div style={{ fontSize: 10.5, color: "var(--t3)" }}>{subscribed ? "This device is subscribed to alerts." : "Turn on farm alerts for this device."}</div>
      </div>
      <button type="button" onClick={enable} disabled={busy} style={btn(!subscribed)}>{subscribed ? "Re-enable" : "Enable notifications"}</button>
      <button type="button" onClick={test} disabled={busy || !subscribed} style={btn(subscribed)}>Test this device</button>
      <details style={{ flexBasis: "100%", fontSize: 12, color: "var(--t2)" }}>
        <summary style={{ cursor: "pointer" }}>No notification appearing?</summary>
        <p>Tests only notify the device you are using. Check its Notification Centre and make sure Do Not Disturb or Focus is off.</p>
        <p>On Mac: System Settings → Notifications → SenseAgri (or your browser) → Allow notifications and Banners. On Samsung: Settings → Notifications → App notifications → your browser or SenseAgri → allow notifications.</p>
        <button type="button" onClick={checkDisplay} disabled={busy} style={btn(false)}>Check display on this device</button>
      </details>
      {msg.text && <div role="status" style={{ flexBasis: "100%", fontSize: 11.5, fontWeight: 600, color: msg.tone === "err" ? "#B91C1C" : msg.tone === "ok" ? "#166534" : "var(--t3)" }}>{msg.text}</div>}
    </div>
  );
}
