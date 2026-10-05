import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Freestyle } from "freestyle";
import { client } from "../node_modules/freestyle/dist/cli/context.js";
import { notebookVmOptions } from "../convex/lib/notebookLifecycle.ts";
import {
  kernelScript,
  installKernel,
  startKernel,
  kernelPreloads,
} from "../convex/lib/jupyterKernel.ts";

// One disposable VM. Synthetic data only; no project key is provisioned.
const sdk = process.env.FREESTYLE_API_KEY ? new Freestyle() : await client({});
let vm;
try {
  vm = (
    await sdk.vms.create({
      slug: `monitor-jupyter-smoke-${crypto.randomUUID()}`,
      snapshotId: "freestyle/ubuntu",
      ...notebookVmOptions,
      firewall: { rules: [] },
    })
  ).vm;
  const rules = [];
  for (const domain of ["pypi.org", "files.pythonhosted.org"])
    rules.push(
      await sdk.tls.rules.create({
        action: "allow",
        domain,
        source: { vmId: vm.id },
        destination: { public: true },
      }),
    );
  console.log("Installing Jupyter and Plotly in disposable VM…");
  const install = await vm.exec({ command: installKernel, timeoutMs: 150000 });
  if (install.statusCode !== 0)
    throw new Error(
      `Runtime install failed: ${install.stderr}\n${install.stdout}`,
    );
  for (const rule of rules) await sdk.tls.rules.delete(rule.id);
  assert.equal((await sdk.tls.rules.list({ vmId: vm.id })).rules.length, 0);
  console.log("PASS: Package download routes removed before cell execution.");
  await vm.fs.writeTextFile("/tmp/monitor-jupyter.py", kernelScript);
  const start = await vm.exec({ command: startKernel, timeoutMs: 45000 });
  if (start.statusCode !== 0) {
    const log = await vm.exec({
      command: "cat /tmp/monitor-jupyter.log",
      timeoutMs: 5000,
    });
    throw new Error(`Kernel startup failed: ${log.stdout}`);
  }
  async function cell(code, timeoutMs = 10000) {
    await vm.fs.writeTextFile(
      "/tmp/cell.json",
      JSON.stringify({
        code,
        timeoutMs,
        context: {
          project: { name: "Synthetic validation" },
          events: [],
          results: [],
        },
      }),
    );
    const result = await vm.exec({
      command:
        "curl -fsS --max-time 50 -H 'Content-Type: application/json' --data-binary @/tmp/cell.json http://127.0.0.1:8766/execute",
      timeoutMs: 55000,
    });
    assert.equal(result.statusCode, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  const preloadedRequest =
    "request = urllib.request.Request('data:application/json,%7B%22ready%22%3Atrue%7D')\nwith urllib.request.urlopen(request, timeout=5) as response:\n    print(json.load(response)['ready'])\nprint(urllib.parse.urlparse('https://example.com/check').path)\nprint(issubclass(urllib.error.HTTPError, urllib.error.URLError))";
  const imports = await cell(preloadedRequest);
  assert.equal(imports.status, "ok", imports.stderr);
  assert.equal(imports.stdout.trim(), "True\n/check\nTrue");
  console.log(
    "PASS: urllib.request, urllib.error and urllib.parse work immediately without imports or external network.",
  );
  const helperCheck = await cell(`
network = [{'url': 'data:application/json,' + urllib.parse.quote(json.dumps(payload)), 'method': 'GET'} for payload in [
    {'status': 'success', 'value': {'page': [{'name': 'demoCustomers'}], 'isDone': True}},
    {'entries': [], 'cursor': 42},
    {'status': 'error', 'errorMessage': 'synthetic query failure'},
]]
print(request_json()['page'][0]['name'])
print(request_json(1)['cursor'])
try:
    request_json(2)
except RuntimeError as error:
    print(str(error))
`);
  assert.equal(helperCheck.status, "ok", helperCheck.stderr);
  assert.equal(
    helperCheck.stdout.trim(),
    "demoCustomers\n42\nsynthetic query failure",
  );
  console.log(
    "PASS: request_json unwraps Convex values, preserves log payloads and raises query errors.",
  );
  assert.equal(
    (
      await cell(
        "values = [2, 4, 6]\nwith open('/tmp/persistent-chat.txt', 'w') as f: f.write('saved')\nprint(sum(values))",
      )
    ).stdout.trim(),
    "12",
  );
  // Simulate an older kernel's namespace, then apply the same in-place import cell.
  assert.equal((await cell("del urllib")).status, "ok");
  assert.equal((await cell(kernelPreloads)).status, "ok");
  const upgraded = await cell(preloadedRequest + "\nprint(sum(values))");
  assert.equal(upgraded.status, "ok", upgraded.stderr);
  assert.equal(upgraded.stdout.trim(), "True\n/check\nTrue\n12");
  console.log(
    "PASS: Preloading an existing kernel preserves its analysis variables.",
  );
  const policy = await vm.data();
  assert(policy.ttlSeconds == null || policy.ttlSeconds === -1);
  assert.notEqual(policy.autoDeleteSeconds, 0);
  assert.equal(policy.idleTimeoutSeconds, 600);
  assert.equal((await vm.pause()).state, "paused");
  await vm.start();
  assert.equal(
    (
      await cell("print(sum(values), open('/tmp/persistent-chat.txt').read())")
    ).stdout.trim(),
    "12 saved",
  );
  console.log(
    "PASS: Persistent VM has no TTL, pauses/resumes, and retains Jupyter memory and files.",
  );
  const chart = await cell(
    "values.append(8)\nfig = go.Figure(go.Bar(x=['A', 'B', 'C', 'D'], y=values))\nfig.update_layout(title='Synthetic notebook validation', xaxis_title='Category', yaxis_title='Value')\nfig.show()\nprint(sum(values))",
  );
  assert.equal(chart.status, "ok");
  assert.equal(chart.stdout.trim(), "20");
  assert.equal(chart.charts.length, 1);
  assert.deepEqual(chart.charts[0].data[0].y, [2, 4, 6, 8]);
  console.log(
    "PASS: Variables persisted across two cells; native Plotly MIME figure captured.",
  );
  const dataframeChart = await cell(
    "frame = pd.DataFrame({'x':[1,2,3], 'y':[4,5,6]})\npx.line(frame, x='x', y='y', title='DataFrame chart').show()",
  );
  assert.equal(dataframeChart.charts.length, 1);
  assert.deepEqual(dataframeChart.charts[0].data[0].x, [1, 2, 3]);
  console.log(
    "PASS: pandas/Plotly Express typed arrays decoded to JSON arrays.",
  );
  const error = await cell("raise ValueError('intentional smoke error')");
  assert.equal(error.status, "error");
  assert.match(error.stderr, /intentional smoke error/);
  const clipped = await cell("print('x' * 20000)");
  assert.equal(clipped.stdout.length, 12000);
  assert.equal(clipped.outputTruncated, true);
  const html = await cell(
    "from IPython.display import HTML\ndisplay(HTML('<script>alert(1)</script>'))",
  );
  assert.equal(JSON.stringify(html).includes("<script>"), false);
  console.log("PASS: Errors, output limits and untrusted HTML handling.");
  const timeout = await cell("import time\ntime.sleep(20)", 1000);
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.kernelReset, true);
  console.log(
    "PASS: Timeout stops the kernel and requests a fresh notebook session.",
  );
  await writeFile(
    "/tmp/convex-monitor-jupyter-smoke.json",
    JSON.stringify(
      { ...chart, sessionReused: true, timeoutMs: 10000 },
      null,
      2,
    ),
  );
} finally {
  if (vm) {
    await vm.delete();
    console.log("PASS: Disposable Jupyter VM deleted.");
  }
}
