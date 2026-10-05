import { useEffect, useState } from "react";

export function ThinkingStatus() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((performance.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed =
    seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;

  return (
    <div
      role="status"
      className="thinking-status mx-auto flex min-h-6 w-full max-w-[680px] items-center gap-2 py-1 text-xs text-accent-plum"
    >
      <span aria-hidden="true" className="thinking-spinner" />
      <span className="thinking-sweep">Thinking</span>
      <span
        aria-hidden="true"
        title="Time spent thinking"
        className="ml-1 min-w-[7ch] text-ink-3 tabular-nums"
      >
        {elapsed}
      </span>
    </div>
  );
}
