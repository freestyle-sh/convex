// Record durations only: never include request bodies, credentials or output.
export function timings() {
  const started = performance.now();
  const phases: Record<string, number> = {};
  return {
    phases,
    elapsed: () => Math.round(performance.now() - started),
    async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try {
        return await operation();
      } finally {
        phases[name] =
          (phases[name] ?? 0) + Math.round(performance.now() - start);
      }
    },
  };
}
