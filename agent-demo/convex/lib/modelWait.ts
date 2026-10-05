// Limit silent model waits without using up the sandbox's own execution timeout.
export function modelWait(timeoutMs = 60_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let toolsRunning = 0;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const pulse = () => {
    clear();
    if (!toolsRunning && !controller.signal.aborted)
      timer = setTimeout(
        () => controller.abort(new Error("Model response timed out.")),
        timeoutMs,
      );
  };
  return {
    signal: controller.signal,
    pulse,
    clear,
    toolStarted: () => {
      toolsRunning++;
      clear();
    },
    toolFinished: () => {
      toolsRunning--;
      pulse();
    },
  };
}
