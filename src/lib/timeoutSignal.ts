// AbortSignal.timeout is missing on older iOS Safari (< 16); fall back to an AbortController + timer.
// Pass `parent` (aborted on unmount or when the request finishes) so the fallback timer is cleared
// instead of firing after the caller is done. A native timeout signal has no public cancel.
export function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const canNative = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function";
  if (canNative && parent == null) return AbortSignal.timeout(ms);
  if (canNative && parent && typeof AbortSignal.any === "function") return AbortSignal.any([parent, AbortSignal.timeout(ms)]);
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  c.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (parent) {
    if (parent.aborted) c.abort();
    else parent.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c.signal;
}
