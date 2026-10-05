import assert from "node:assert/strict";
import { Freestyle } from "freestyle";
import { client } from "../node_modules/freestyle/dist/cli/context.js";
import { readConfig } from "../node_modules/freestyle/dist/cli/config.js";

// Explicit live smoke test: one disposable 180-second VM, synthetic credentials only.
if (!process.env.FREESTYLE_API_KEY && !readConfig().refreshToken)
  throw new Error("Set FREESTYLE_API_KEY or sign in with the Freestyle CLI.");
const sdk = process.env.FREESTYLE_API_KEY ? new Freestyle() : await client({});
const fakeSecret = "convex-monitor-synthetic-" + crypto.randomUUID();
const approvedBody = {
  path: "diagnostics:approved",
  args: { item: "only-this-item" },
  format: "json",
};
let vm;
try {
  const created = await sdk.vms.create({
    slug: "convex-monitor-smoke-" + crypto.randomUUID(),
    snapshotId: "freestyle/ubuntu",
    ttlSeconds: 180,
    idleTimeoutSeconds: 90,
    autoDeleteSeconds: 0,
    firewall: { rules: [] },
  });
  vm = created.vm;
  await sdk.tls.rules.create({
    action: "allow",
    domain: "httpbingo.org",
    source: { vmId: vm.id },
    destination: { public: true },
    match: { method: ["POST"], path: { exact: "/post" } },
    transform: [
      { headers: { Authorization: "Bearer " + fakeSecret } },
      { jsonPatch: [{ op: "replace", path: "", value: approvedBody }] },
    ],
  });
  const diagnostics = await vm.exec({
    command:
      "cat /etc/hosts; test -f /usr/local/share/ca-certificates/freestyle-tls.crt && echo CA-ready",
    timeoutMs: 5000,
  });
  console.log("Guest routing:", diagnostics.stdout);
  const python = "/tmp/monitor-trust-check/bin/python";
  const venv = await vm.exec({
    command: "python3 -m venv /tmp/monitor-trust-check",
    timeoutMs: 20000,
  });
  assert.equal(
    venv.statusCode,
    0,
    "Could not create Python virtual environment",
  );
  const request = async (path, method, body) => {
    const script = [
      "import json, urllib.request, ssl",
      "assert ssl.create_default_context().verify_mode == ssl.CERT_REQUIRED",
      "assert ssl.create_default_context().check_hostname",
      "req=urllib.request.Request(" +
        JSON.stringify("https://httpbingo.org" + path) +
        ",data=" +
        (body ? "json.dumps(" + JSON.stringify(body) + ").encode()" : "None") +
        ",method=" +
        JSON.stringify(method) +
        ",headers={'Content-Type':'application/json'})",
      "try:",
      " with urllib.request.urlopen(req,timeout=20) as r: print(r.read(262144).decode())",
      "except urllib.error.HTTPError as e:",
      " print(e.read(4000).decode()); raise",
    ].join("\n");
    const result = await vm.exec({
      command: python + " -c '" + script.replaceAll("'", "'\\''") + "'",
      timeoutMs: 30_000,
    });
    if (result.statusCode !== 0)
      throw new Error(
        "Guest request failed: " +
          (result.stdout ?? "").slice(0, 1500) +
          (result.stderr ?? "").slice(-600),
      );
    return JSON.parse(result.stdout);
  };
  const matched = await request("/post", "POST", {
    path: "attempted:other",
    args: { item: "wrong" },
  });
  assert.equal(matched.headers.Authorization?.[0], "Bearer " + fakeSecret);
  assert.deepEqual(matched.json, approvedBody);
  console.log(
    "PASS: Python venv default certificate trust verified; TLS edge injected a synthetic secret and replaced an altered request with the exact authorized JSON.",
  );
  const unmatched = await request("/get", "GET");
  assert.equal(unmatched.headers.Authorization, undefined);
  console.log("PASS: Different method/path received no injected credential.");
  const rules = await sdk.tls.rules.list({ vmId: vm.id });
  assert.equal(rules.rules[0].transform[0].headers.Authorization, "***");
  console.log("PASS: TLS rule readback redacts injected credentials.");
  const env = await vm.exec({ command: "env", timeoutMs: 5000 });
  assert(!env.stdout.includes(fakeSecret));
  console.log("PASS: Credential absent from guest environment.");
} finally {
  if (vm) {
    const id = vm.id;
    await vm.delete();
    const rules = await sdk.tls.rules.list({ vmId: id }).catch((error) => {
      if (error.status === 404) return { rules: [] };
      throw error;
    });
    assert.equal(rules.rules.length, 0);
    console.log("PASS: Deleted smoke VM; no TLS grants remain.");
  }
}
