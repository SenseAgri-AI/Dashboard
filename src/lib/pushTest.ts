export type PushTestResult = "displayed" | "display-failed" | "timeout" | "cancelled";

/** Listen before sending, so a fast push cannot beat the API response. */
export function watchPushTest(worker: ServiceWorkerContainer, testId: string, timeoutMs = 15_000) {
  let finish: (result: PushTestResult) => void = () => {};
  const result = new Promise<PushTestResult>((resolve) => {
    let done = false;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "senseagri-push-test" || data.testId !== testId) return;
      if (data.status === "displayed" || data.status === "display-failed") finish(data.status);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      resolve(value);
    };
    worker.addEventListener("message", onMessage);
  });
  return { result, cancel: () => finish("cancelled") };
}
