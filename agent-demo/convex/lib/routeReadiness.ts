// Exact Freestyle TLS names are installed in the guest's hosts file. Checking
// that file avoids a slow public DNS fallback for private .internal names and
// never contacts the relay or consumes its single-use request.
export class RouteNotReadyError extends Error {
  constructor() {
    super("Sandbox route is not ready. The notebook cell was not executed.");
  }
}

export function routeReadinessCommand(domain: string, waitMs: number) {
  if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error("Invalid route hostname");
  const script = `import pathlib, time, ipaddress
deadline = time.monotonic() + ${waitMs / 1000}
while True:
    for line in pathlib.Path("/etc/hosts").read_text().splitlines():
        fields = line.split("#", 1)[0].split()
        if len(fields) > 1 and ${JSON.stringify(domain)} in fields[1:]:
            try: ipaddress.ip_address(fields[0])
            except ValueError: continue
            raise SystemExit(0)
    if time.monotonic() >= deadline: raise SystemExit(1)
    time.sleep(0.1)
`;
  return `python3 -c '${script.replaceAll("'", "'\\''")}'`;
}

export async function ensureRouteReady(
  vm: {
    exec: (args: {
      command: string;
      timeoutMs: number;
    }) => Promise<{ statusCode?: number | null }>;
  },
  domain: string,
  reapply: () => Promise<unknown>,
) {
  const check = (waitMs: number) =>
    vm.exec({
      command: routeReadinessCommand(domain, waitMs),
      timeoutMs: waitMs + 2000,
    });
  if ((await check(1000)).statusCode === 0) return false;
  // Reassert this exact existing route only. No new permissions, HTTP retries,
  // or replay of notebook code, even when the granted operation is a write.
  await reapply();
  if ((await check(5000)).statusCode !== 0) throw new RouteNotReadyError();
  return true;
}
