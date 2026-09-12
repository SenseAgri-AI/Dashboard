"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { claimPushPrompt } from "@/lib/pushPrompt";
import { registerPushDevice } from "@/lib/pushRegistration";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
export default function PushNotificationPrompt() {
  const { isLoaded, userId, orgId } = useAuth();
  if (!isLoaded || !userId || !orgId) return null;
  return <DevicePrompt key={`${userId}:${orgId}`} />;
}

function DevicePrompt() {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const modal = dialog.current;
    // Defer so React's development effect replay cannot consume the one-time prompt.
    const timer = setTimeout(() => {
      if (!VAPID_PUBLIC || !window.isSecureContext || !("Notification" in window) ||
          !("PushManager" in window) || !("serviceWorker" in navigator) || !modal?.showModal) return;
      const storage = {
        getItem: (key: string) => localStorage.getItem(key),
        setItem: (key: string, value: string) => localStorage.setItem(key, value),
      };
      if (claimPushPrompt(Notification.permission, storage)) modal.showModal();
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); modal?.close(); };
  }, []);

  const enable = async () => {
    setBusy(true); setError("");
    const signal = request.current?.signal;
    try {
      const permission = await Notification.requestPermission();
      if (signal?.aborted) return;
      if (permission !== "granted") { dialog.current?.close(); return; }
      await registerPushDevice(VAPID_PUBLIC!, signal);
      if (signal?.aborted) return;
      window.dispatchEvent(new Event("senseagri-push-changed"));
      dialog.current?.close();
    } catch {
      if (!signal?.aborted) setError("Couldn't enable notifications. Try again, or use the toggle on Home later.");
    } finally { if (!signal?.aborted) setBusy(false); }
  };

  return (
    <dialog ref={dialog} aria-labelledby="push-prompt-title" aria-describedby="push-prompt-description"
      style={{ margin: "auto", width: "min(400px, calc(100vw - 32px))", padding: 24, border: "1px solid var(--divider)", borderRadius: 16, background: "#fff", color: "#002E35", boxShadow: "0 16px 64px #0003" }}>
      <h2 id="push-prompt-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px" }}>Enable farm notifications?</h2>
      <p id="push-prompt-description" style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 20px" }}>Get important farm alerts on this device, even when the app is closed. You can change this on Home anytime.</p>
      {error && <p role="alert" style={{ color: "#B91C1C", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()} style={{ padding: "10px 14px", cursor: "pointer" }}>Not now</button>
        <button type="button" disabled={busy} onClick={enable} style={{ padding: "10px 16px", borderRadius: 8, background: "#002E35", color: "white", cursor: "pointer" }}>{busy ? "Enabling…" : "Enable notifications"}</button>
      </div>
    </dialog>
  );
}
