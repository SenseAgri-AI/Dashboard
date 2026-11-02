// AbortSignal.timeout is missing on older iOS Safari (< 16); fall back to an AbortController + timer.
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
