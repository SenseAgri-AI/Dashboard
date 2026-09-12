const PROMPT_SEEN = "senseagri-push-prompt-seen";
let seenThisSession = false;

/** One prompt per browser profile, including when storage is unavailable. */
export function claimPushPrompt(permission: NotificationPermission, storage: Pick<Storage, "getItem" | "setItem">): boolean {
  if (permission !== "default" || seenThisSession) return false;
  try {
    if (storage.getItem(PROMPT_SEEN)) return false;
    storage.setItem(PROMPT_SEEN, "1");
  } catch { /* In-session fallback when browser storage is blocked. */ }
  seenThisSession = true;
  return true;
}
