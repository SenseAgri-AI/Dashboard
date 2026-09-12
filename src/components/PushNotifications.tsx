"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { registerPushDevice } from "@/lib/pushRegistration";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
export default function PushNotifications() {
  const { isLoaded, userId, orgId } = useAuth();
  if (!isLoaded || !userId || !orgId) return null;
  return <DeviceNotifications key={`${userId}:${orgId}`} />;
}

function DeviceNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void (async () => {
      const supported = !!VAPID_PUBLIC && window.isSecureContext && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
      setAvailable(supported);
      try {
        if (supported && Notification.permission === "granted") {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          if (sub) {
            const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { signal: request.signal });
            if (!res.ok) throw new Error();
            const data = await res.json();
            if (!request.signal.aborted) setEnabled(data.subscribed === true);
          }
        }
      } catch {
        if (!request.signal.aborted) setError("Couldn't connect notifications. Toggle on to retry.");
      } finally { if (!request.signal.aborted) setBusy(false); }
    })();
    return () => request.abort();
  }, []);

  const toggle = async () => {
    setBusy(true); setError("");
    const signal = controller.current?.signal;
    try {
      if (enabled) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          const res = await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), signal });
          if (!res.ok) throw new Error("Couldn't turn notifications off. Please retry.");
        }
        if (signal?.aborted) return;
        // Remove this farm's server subscription, retaining other farms on this browser.
        setEnabled(false);
      } else {
        const permission = await Notification.requestPermission();
        if (signal?.aborted) return;
        if (permission !== "granted") throw new Error("Allow notifications in your browser settings, then turn this on.");
        await registerPushDevice(VAPID_PUBLIC!, signal);
        if (signal?.aborted) return;
        setEnabled(true);
      }
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "Couldn't update notifications.");
    } finally { if (!signal?.aborted) setBusy(false); }
  };

  return (
    <div style={{ alignSelf: "flex-end", fontSize: 12, color: "var(--t2)", maxWidth: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <span id="notification-toggle-label">Notifications</span>
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby="notification-toggle-label" disabled={busy || !available} onClick={toggle}
          style={{ width: 38, height: 22, padding: 3, borderRadius: 12, border: 0, background: enabled ? "#16838D" : "#9CA3AF", opacity: busy ? 0.5 : 1, cursor: busy || !available ? "default" : "pointer" }}>
          <span style={{ display: "block", width: 16, height: 16, borderRadius: "50%", background: "white", transform: enabled ? "translateX(16px)" : "none", transition: "transform 150ms" }} />
        </button>
      </div>
      {!busy && !available && <p style={{ marginTop: 6 }}>Notifications aren&apos;t available in this browser.</p>}
      {error && <p role="status" style={{ color: "#B91C1C", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
