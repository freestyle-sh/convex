import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  ensureRouteReady,
  routeReadinessCommand,
} from "../convex/lib/routeReadiness";

describe("notebook route readiness", () => {
  it.each([true, false])(
    "waits for guest host propagation without DNS or HTTP (arrives=%s)",
    (arrives) => {
      const harness = [
        "import pathlib, time, socket, shlex, sys, json",
        "elapsed = 0",
        "reads = 0",
        "def read_hosts(self):",
        "    global reads",
        "    reads += 1",
        "    assert str(self) == '/etc/hosts'",
        "    if " + (arrives ? "True" : "False") + " and elapsed >= 0.3:",
        "        return '# route installed\\n10.1.2.3 unrelated request.test.monitor.internal # comment\\n'",
        "    return '127.0.0.1 localhost\\n# 10.1.2.3 request.test.monitor.internal\\n'",
        "def sleep(seconds):",
        "    global elapsed",
        "    elapsed += seconds",
        "def no_network(*args, **kwargs): raise AssertionError('No DNS or HTTP before readiness')",
        "pathlib.Path.read_text = read_hosts",
        "time.monotonic = lambda: elapsed",
        "time.sleep = sleep",
        "socket.getaddrinfo = no_network",
        "socket.socket = no_network",
        "try: exec(shlex.split(sys.argv[1])[2])",
        "except SystemExit as e: print(json.dumps({'code': e.code, 'elapsed': elapsed, 'reads': reads}))",
      ].join("\n");
      const result = JSON.parse(
        execFileSync(
          "python3",
          [
            "-c",
            harness,
            routeReadinessCommand("request.test.monitor.internal", 1000),
          ],
          { encoding: "utf8" },
        ),
      );
      expect(result.code).toBe(arrives ? 0 : 1);
      expect(result.elapsed).toBeLessThanOrEqual(1.1);
      expect(result.reads).toBeGreaterThan(1);
    },
  );
  it("does not rewrite a ready rule", async () => {
    const vm = { exec: vi.fn().mockResolvedValue({ statusCode: 0 }) };
    const reapply = vi.fn();
    expect(await ensureRouteReady(vm, "ready.monitor.internal", reapply)).toBe(
      false,
    );
    expect(reapply).not.toHaveBeenCalled();
  });
  it("reasserts a missing route once, then waits before releasing the cell", async () => {
    const vm = {
      exec: vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 1 })
        .mockResolvedValueOnce({ statusCode: 0 }),
    };
    const reapply = vi.fn().mockResolvedValue(undefined);
    expect(await ensureRouteReady(vm, "late.monitor.internal", reapply)).toBe(
      true,
    );
    expect(reapply).toHaveBeenCalledOnce();
    expect(vm.exec.mock.invocationCallOrder[0]).toBeLessThan(
      reapply.mock.invocationCallOrder[0],
    );
    expect(reapply.mock.invocationCallOrder[0]).toBeLessThan(
      vm.exec.mock.invocationCallOrder[1],
    );
  });
  it("fails before cell execution when propagation never completes", async () => {
    const vm = { exec: vi.fn().mockResolvedValue({ statusCode: 1 }) };
    const reapply = vi.fn().mockResolvedValue(undefined);
    await expect(
      ensureRouteReady(vm, "missing.monitor.internal", reapply),
    ).rejects.toThrow("cell was not executed");
    expect(reapply).toHaveBeenCalledOnce();
    expect(vm.exec).toHaveBeenCalledTimes(2);
    expect(() => routeReadinessCommand("bad';echo secret", 1000)).toThrow();
  });
});
